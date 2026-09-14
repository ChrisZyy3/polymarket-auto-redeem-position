export default function Home() {
  return (
    <main style={{ maxWidth: 760, margin: "48px auto", padding: 24, fontFamily: "system-ui" }}>
      <h1>PolyYield V1</h1>
      <p>APY-native Polymarket maker strategy preview.</p>
      <p>Rebalancing decisions are exposed by <code>/api/rebalance</code>.</p>
    </main>
  );
}
