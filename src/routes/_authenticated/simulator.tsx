import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { PageHeader } from "@/components/app-shell";
import { Explain, TERMS } from "@/components/explain";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { defaultEndpoint, run, today } from "@/lib/calculation";
import { NoAgreement } from "@/components/no-agreement";
import { useHousehold } from "@/components/household-context";
import { useHouseholdData } from "@/hooks/use-household-data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { isDemo } from "@/lib/demo";
import {
  deleteScenario,
  listScenarios,
  saveScenario,
  setDefaultScenario,
  type Scenario,
} from "@/lib/scenarios.functions";
import {
  compareDates,
  kr,
  linearValue,
  parseDate,
  toIsoDate,
  toKronor,
  type AgreementParams,
  type CostCategoryRule,
  type Endpoint,
  type Transaction,
} from "@/lib/engine";
import { fmtAndel, fmtDate, fmtEnheter, fmtKr } from "@/lib/format";
import { PARTY_LABELS } from "@/lib/seed";

export const Route = createFileRoute("/_authenticated/simulator")({
  head: () => ({ meta: [{ title: "Simulator – Mitt & Ditt" }] }),
  component: Simulator,
});

/** Serierna är direktmärkta och skiljs även åt med streckmönster, inte bara färg. */
const SERIES = {
  valt: { color: "var(--data-blue)", label: "Valt slutvärde", dash: undefined },
  upp: { color: "var(--positive)", label: "Högre värde", dash: "6 4" },
  ned: { color: "var(--data-gold)", label: "Lägre värde", dash: "2 4" },
} as const;

function Simulator() {
  const { agreement, rules, transactions, isLoading } = useHouseholdData();
  if (!agreement) {
    return (
      <>
        <PageHeader eyebrow="Prognos" title="Simulator" />
        <NoAgreement loading={isLoading} />
      </>
    );
  }
  return <SimulatorFor agreement={agreement} rules={rules} transactions={transactions} />;
}

function SimulatorFor({
  agreement,
  rules,
  transactions,
}: {
  agreement: AgreementParams;
  rules: CostCategoryRule[];
  transactions: Transaction[];
}) {
  const base = useMemo(
    () => defaultEndpoint(agreement, rules, transactions),
    [agreement, rules, transactions],
  );

  const [endDate, setEndDate] = useState(() => {
    const fiveYears = `${Number(agreement.startDate.slice(0, 4)) + 5}${agreement.startDate.slice(4)}`;
    return compareDates(fiveYears, today()) > 0 ? fiveYears : base.endDate;
  });
  const [endValue, setEndValue] = useState(toKronor(agreement.startValue));
  const [endLoan, setEndLoan] = useState(toKronor(base.endLoan));
  const [saleCosts, setSaleCosts] = useState(0);
  const [scenario, setScenario] = useState(10);
  const [scenarioNamn, setScenarioNamn] = useState("");

  const klient = useQueryClient();
  const { household } = useHousehold();
  const householdId = household?.id as string;

  const scenarier = useQuery({
    queryKey: ["scenarios", householdId],
    queryFn: () => listScenarios({ data: { householdId } }),
    enabled: !isDemo && Boolean(householdId),
  });

  /** Läser in ett sparat antagande i formuläret. Skriver inget. */
  function laddaScenario(s: Scenario) {
    setEndDate(s.endDate);
    setEndValue(toKronor(s.endValueOre));
    setEndLoan(toKronor(s.endLoanOre));
    setSaleCosts(toKronor(s.saleCostsOre));
    setScenario(s.spreadPercent);
    setScenarioNamn(s.name);
  }

  const spara = useMutation({
    mutationFn: () =>
      saveScenario({
        data: {
          householdId,
          name: scenarioNamn.trim(),
          endDate,
          endValueOre: kr(endValue || 0),
          endLoanOre: kr(endLoan || 0),
          saleCostsOre: kr(saleCosts || 0),
          spreadPercent: scenario,
        },
      }),
    onSuccess: () => {
      toast.success("Scenariot är sparat.");
      void klient.invalidateQueries({ queryKey: ["scenarios"] });
    },
    onError: (fel: Error) => toast.error(fel.message || "Kunde inte spara scenariot."),
  });

  const valjStandard = useMutation({
    mutationFn: (scenarioId: string | null) =>
      setDefaultScenario({ data: { householdId, scenarioId } }),
    onSuccess: () => {
      toast.success("Översiktens antagande är uppdaterat.");
      void klient.invalidateQueries();
    },
    onError: (fel: Error) => toast.error(fel.message || "Kunde inte välja scenario."),
  });

  const taBort = useMutation({
    mutationFn: (scenarioId: string) => deleteScenario({ data: { householdId, scenarioId } }),
    onSuccess: () => {
      toast.success("Scenariot är borttaget.");
      void klient.invalidateQueries({ queryKey: ["scenarios"] });
    },
    onError: (fel: Error) => toast.error(fel.message || "Kunde inte ta bort scenariot."),
  });

  const endpoint: Endpoint = {
    mode: "prognos",
    endDate,
    endValue: kr(endValue || 0),
    endLoan: kr(endLoan || 0),
    saleCosts: kr(saleCosts || 0),
  };

  const result = useMemo(
    () => runSafely(agreement, rules, transactions, endpoint),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agreement, rules, transactions, endDate, endValue, endLoan, saleCosts],
  );

  const up = useMemo(
    () =>
      runSafely(agreement, rules, transactions, {
        ...endpoint,
        endValue: kr((endValue || 0) * (1 + scenario / 100)),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agreement, rules, transactions, endDate, endValue, endLoan, saleCosts, scenario],
  );
  const down = useMemo(
    () =>
      runSafely(agreement, rules, transactions, {
        ...endpoint,
        endValue: kr((endValue || 0) * (1 - scenario / 100)),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agreement, rules, transactions, endDate, endValue, endLoan, saleCosts, scenario],
  );

  const [a, b] = agreement.parties;

  const valuePoints = useMemo(() => {
    if (!result) return [];
    const dates = [
      agreement.startDate,
      ...result.events.map((e) => e.date),
      endpoint.endDate,
    ].filter((d, i, all) => all.indexOf(d) === i);
    dates.sort(compareDates);
    return dates.map((date) => ({
      date,
      t: parseDate(date),
      valt: toKronor(
        linearValue(
          agreement.startDate,
          agreement.startValue,
          endpoint.endDate,
          endpoint.endValue,
          date,
        ),
      ),
      upp: toKronor(
        linearValue(
          agreement.startDate,
          agreement.startValue,
          endpoint.endDate,
          kr((endValue || 0) * (1 + scenario / 100)),
          date,
        ),
      ),
      ned: toKronor(
        linearValue(
          agreement.startDate,
          agreement.startValue,
          endpoint.endDate,
          kr((endValue || 0) * (1 - scenario / 100)),
          date,
        ),
      ),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, agreement, endDate, endValue, scenario]);

  const sharePoints = useMemo(() => {
    if (!result) return [];
    const points = [
      {
        date: agreement.startDate,
        t: parseDate(agreement.startDate),
        [a]: (agreement.startUnits[a] / agreement.totalUnits) * 100,
        [b]: (agreement.startUnits[b] / agreement.totalUnits) * 100,
      },
      ...result.events.map((e) => ({
        date: e.date,
        t: parseDate(e.date),
        [a]: e.sharesAfter[a] * 100,
        [b]: e.sharesAfter[b] * 100,
      })),
    ];
    const last = points[points.length - 1];
    if (last && last.date !== endDate) {
      points.push({ ...last, date: endDate, t: parseDate(endDate) });
    }
    return points;
  }, [result, agreement, a, b, endDate]);

  if (!result) {
    return (
      <>
        <PageHeader eyebrow="Prognos" title="Simulator" />
        <div className="tile-surface p-8 text-center text-sm text-muted-foreground">
          Slutdagen måste ligga på eller efter startdagen {fmtDate(agreement.startDate)}.
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Prognos"
        title="Simulator"
        description="Testa olika slutvärden och se hur andelar och utbetalning påverkas."
        info={<Explain {...TERMS.prognos} />}
      />

      <p className="mb-6 rounded-md border border-hairline bg-secondary/60 p-3 text-sm leading-relaxed">
        Detta är en prognos. Resultatet blir bindande enligt avtalet först när verkligt
        försäljningspris eller fastställt utköpsvärde används i slutavräkningen. Ingenting du ändrar
        här sparas eller påverkar avtal, transaktioner eller godkända andelar.
      </p>

      <section className="tile-surface mb-6 grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Antagen slutdag">
          <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </Field>
        <Field label="Antaget bostadsvärde">
          <Input
            type="number"
            inputMode="numeric"
            value={endValue}
            onChange={(e) => setEndValue(Number(e.target.value))}
          />
        </Field>
        <Field label="Kvarvarande lån">
          <Input
            type="number"
            inputMode="numeric"
            value={endLoan}
            onChange={(e) => setEndLoan(Number(e.target.value))}
          />
        </Field>
        <Field label="Faktiska försäljningskostnader">
          <Input
            type="number"
            inputMode="numeric"
            value={saleCosts}
            onChange={(e) => setSaleCosts(Number(e.target.value))}
          />
        </Field>
        <Field label={`Scenario ±${scenario} %`}>
          <Input
            type="range"
            min={0}
            max={30}
            step={1}
            value={scenario}
            onChange={(e) => setScenario(Number(e.target.value))}
          />
        </Field>
      </section>

      {!isDemo && (
        <section className="tile-surface mb-6 p-5">
          <p className="eyebrow mb-1">Sparade scenarier</p>
          <p className="mb-4 text-sm text-muted-foreground">
            Ett scenario är ett antagande, inte ett beslut. Att spara eller välja ett ändrar varken
            avtalet, posterna eller era andelar – det styr bara vad som räknas fram här och vilket
            antagande översiktens prognos utgår från.
          </p>

          <div className="mb-4 flex flex-wrap items-end gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="scenario-namn">Namn</Label>
              <Input
                id="scenario-namn"
                value={scenarioNamn}
                onChange={(e) => setScenarioNamn(e.target.value)}
                placeholder="Till exempel: försäljning 2031"
                maxLength={60}
                className="w-64"
              />
            </div>
            <Button
              variant="outline"
              disabled={spara.isPending || scenarioNamn.trim().length === 0}
              onClick={() => spara.mutate()}
            >
              Spara antagandena
            </Button>
          </div>

          {(scenarier.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Inga sparade scenarier än. Fyll i antagandena ovan och ge dem ett namn.
            </p>
          ) : (
            <ul className="grid gap-2">
              {(scenarier.data ?? []).map((s) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--hairline)] p-3"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium">{s.name}</p>
                      {s.isDefault && <Badge variant="secondary">Översiktens antagande</Badge>}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {fmtDate(s.endDate)} · {fmtKr(toKronor(s.endValueOre))} · spridning ±
                      {s.spreadPercent} % · sparat av {s.createdBy}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => laddaScenario(s)}>
                      Använd här
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={valjStandard.isPending}
                      onClick={() => valjStandard.mutate(s.isDefault ? null : s.id)}
                    >
                      {s.isDefault ? "Sluta använda i översikten" : "Använd i översikten"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={taBort.isPending}
                      onClick={() => taBort.mutate(s.id)}
                    >
                      Ta bort
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="tile-surface mb-6 p-5">
        <div className="mb-1 flex items-center gap-1.5">
          <p className="eyebrow">Beräknat värde över tid</p>
          <Explain {...TERMS.linjartVarde} />
        </div>
        <Legend />
        <div className="mt-3 h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={valuePoints} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
              <CartesianGrid stroke="var(--hairline)" vertical={false} />
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={["dataMin", "dataMax"]}
                tickCount={5}
                tickFormatter={(t: number) => toIsoDate(t).slice(0, 7)}
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                stroke="var(--hairline)"
              />
              {/* Linjediagram över ett smalt värdeintervall: en nollbaslinje
                  skulle trycka ihop hela skillnaden mellan scenarierna. */}
              <YAxis
                width={70}
                domain={[
                  (min: number) => Math.floor((min - 200_000) / 500_000) * 500_000,
                  (max: number) => Math.ceil((max + 200_000) / 500_000) * 500_000,
                ]}
                tickFormatter={(v: number) => `${Math.round(v / 1000)} tkr`}
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                stroke="var(--hairline)"
              />
              <Tooltip
                formatter={(value: number, name: string) => [fmtKr(value), name]}
                labelFormatter={(t: number) => fmtDate(toIsoDate(t))}
                contentStyle={{
                  background: "var(--card)",
                  border: "1px solid var(--hairline)",
                  borderRadius: "var(--radius)",
                  fontSize: 12,
                }}
              />
              <Line
                type="linear"
                dataKey="upp"
                name={SERIES.upp.label}
                stroke={SERIES.upp.color}
                strokeDasharray={SERIES.upp.dash}
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="linear"
                dataKey="ned"
                name={SERIES.ned.label}
                stroke={SERIES.ned.color}
                strokeDasharray={SERIES.ned.dash}
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="linear"
                dataKey="valt"
                name={SERIES.valt.label}
                stroke={SERIES.valt.color}
                strokeWidth={2}
                dot={{ r: 3, fill: SERIES.valt.color, strokeWidth: 0 }}
              />
              {result.events.map((event) => (
                <ReferenceDot
                  key={event.date}
                  x={parseDate(event.date)}
                  y={toKronor(event.linearValue)}
                  r={5}
                  fill={SERIES.valt.color}
                  stroke="var(--card)"
                  strokeWidth={2}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Punkterna är godkända transaktioner placerade på sin betalningsdag. Mellanvärdena är en
          avtalad räknemetod, inte historiska marknadsvärderingar.
        </p>
      </section>

      {sharePoints.length > 1 && (
        <section className="tile-surface mb-6 p-5">
          <div className="mb-1 flex items-center gap-1.5">
            <p className="eyebrow">Andelsutveckling</p>
            <Explain {...TERMS.internAndel} />
          </div>
          <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1">
            {[
              { label: PARTY_LABELS[a] ?? a, color: "var(--copper)", dash: undefined },
              { label: PARTY_LABELS[b] ?? b, color: "var(--data-blue)", dash: "6 4" },
            ].map((s) => (
              <span
                key={s.label}
                className="flex items-center gap-1.5 text-xs text-muted-foreground"
              >
                <svg width="18" height="8" aria-hidden>
                  <line
                    x1="0"
                    y1="4"
                    x2="18"
                    y2="4"
                    stroke={s.color}
                    strokeWidth="2"
                    strokeDasharray={s.dash}
                  />
                </svg>
                {s.label}
              </span>
            ))}
          </div>
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sharePoints} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid stroke="var(--hairline)" vertical={false} />
                <XAxis
                  dataKey="t"
                  type="number"
                  scale="time"
                  domain={["dataMin", "dataMax"]}
                  tickCount={5}
                  tickFormatter={(t: number) => toIsoDate(t).slice(0, 7)}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  stroke="var(--hairline)"
                />
                <YAxis
                  width={58}
                  domain={[0, 100]}
                  ticks={[0, 25, 50, 75, 100]}
                  tickFormatter={(v: number) => `${v} %`}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  stroke="var(--hairline)"
                />
                <Tooltip
                  formatter={(value: number, name: string) => [`${value.toFixed(4)} %`, name]}
                  labelFormatter={(t: number) => fmtDate(toIsoDate(t))}
                  contentStyle={{
                    background: "var(--card)",
                    border: "1px solid var(--hairline)",
                    borderRadius: "var(--radius)",
                    fontSize: 12,
                  }}
                />
                <Line
                  type="stepAfter"
                  dataKey={a}
                  name={PARTY_LABELS[a] ?? a}
                  stroke="var(--copper)"
                  strokeWidth={2}
                  dot={{ r: 3, fill: "var(--copper)", strokeWidth: 0 }}
                />
                <Line
                  type="stepAfter"
                  dataKey={b}
                  name={PARTY_LABELS[b] ?? b}
                  stroke="var(--data-blue)"
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  dot={{ r: 3, fill: "var(--data-blue)", strokeWidth: 0 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      <section className="tile-surface mb-6 overflow-x-auto p-5">
        <p className="eyebrow mb-3">Utfall</p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Post</TableHead>
              <TableHead className="text-right">{PARTY_LABELS[a] ?? a}</TableHead>
              <TableHead className="text-right">{PARTY_LABELS[b] ?? b}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <Row label="Slutliga andelsenheter">
              {[fmtEnheter(result.finalUnits[a]), fmtEnheter(result.finalUnits[b])]}
            </Row>
            <Row label="Slutlig intern andel">
              {[fmtAndel(result.finalShares[a]), fmtAndel(result.finalShares[b])]}
            </Row>
            <Row label="Andel av försäljningsnettot">
              {[
                fmtKr(toKronor(result.settlement.byShare[a])),
                fmtKr(toKronor(result.settlement.byShare[b])),
              ]}
            </Row>
            <Row label="Personliga fordringar, netto">
              {[
                fmtKr(toKronor(result.settlement.claimsNet[a])),
                fmtKr(toKronor(result.settlement.claimsNet[b])),
              ]}
            </Row>
            <Row label="Utanför enhetsmodellen, netto">
              {[
                fmtKr(toKronor(result.settlement.outsideNet[a])),
                fmtKr(toKronor(result.settlement.outsideNet[b])),
              ]}
            </Row>
            <Row label="Beräknad utbetalning" strong>
              {[
                fmtKr(toKronor(result.settlement.finalPosition[a])),
                fmtKr(toKronor(result.settlement.finalPosition[b])),
              ]}
            </Row>
          </TableBody>
        </Table>
        <p className="mt-3 text-xs text-muted-foreground">
          Försäljningsnetto {fmtKr(toKronor(result.settlement.saleNet))}. Summakontrollen visar{" "}
          {result.settlement.checks.ok ? "att allt stämmer." : "en avvikelse som måste utredas."}
        </p>
      </section>

      <section className="tile-surface p-5">
        <p className="eyebrow mb-3">Om värdet blir ett annat</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Sensitivity
            label={`Vid +${scenario} %`}
            color={SERIES.upp.color}
            values={up ? [up.settlement.finalPosition[a], up.settlement.finalPosition[b]] : null}
            parties={[PARTY_LABELS[a] ?? a, PARTY_LABELS[b] ?? b]}
          />
          <Sensitivity
            label={`Vid −${scenario} %`}
            color={SERIES.ned.color}
            values={
              down ? [down.settlement.finalPosition[a], down.settlement.finalPosition[b]] : null
            }
            parties={[PARTY_LABELS[a] ?? a, PARTY_LABELS[b] ?? b]}
          />
        </div>
      </section>
    </>
  );
}

function runSafely(...args: Parameters<typeof run>) {
  try {
    return run(...args);
  } catch {
    return null;
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {Object.values(SERIES).map((s) => (
        <span key={s.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <svg width="18" height="8" aria-hidden>
            <line
              x1="0"
              y1="4"
              x2="18"
              y2="4"
              stroke={s.color}
              strokeWidth="2"
              strokeDasharray={s.dash}
            />
          </svg>
          {s.label}
        </span>
      ))}
    </div>
  );
}

function Row({
  label,
  children,
  strong,
}: {
  label: string;
  children: [string, string];
  strong?: boolean;
}) {
  return (
    <TableRow>
      <TableCell className={strong ? "font-medium" : undefined}>{label}</TableCell>
      <TableCell className={`tabular text-right ${strong ? "font-medium" : ""}`}>
        {children[0]}
      </TableCell>
      <TableCell className={`tabular text-right ${strong ? "font-medium" : ""}`}>
        {children[1]}
      </TableCell>
    </TableRow>
  );
}

function Sensitivity({
  label,
  color,
  values,
  parties,
}: {
  label: string;
  color: string;
  values: [number, number] | null;
  parties: [string, string];
}) {
  return (
    <div className="rounded-md border border-hairline p-3">
      <div className="flex items-center gap-1.5">
        <span className="size-2 rounded-full" style={{ background: color }} aria-hidden />
        <p className="text-xs font-medium">{label}</p>
      </div>
      {values ? (
        <dl className="mt-2 grid gap-1 text-sm">
          {parties.map((name, i) => (
            <div key={name} className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{name}</dt>
              <dd className="tabular">{fmtKr(toKronor(values[i]))}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">Kunde inte beräknas.</p>
      )}
    </div>
  );
}
