export default function Home() {
  return (
    <main
      style={{
        fontFamily: "system-ui, -apple-system, sans-serif",
        maxWidth: 680,
        margin: "0 auto",
        padding: "2.5rem 1.5rem",
        lineHeight: 1.55,
      }}
    >
      <h1 style={{ marginBottom: 0 }}>orchestrant</h1>
      <p style={{ color: "#666", marginTop: 4 }}>
        A framework-agnostic payment orchestration engine.
      </p>
      <p>HTTP API:</p>
      <ul>
        <li>
          <code>POST /api/charge</code> — resolve a route and cascade a charge
        </li>
        <li>
          <code>POST /api/refund</code>
        </li>
        <li>
          <code>POST /api/void</code>
        </li>
        <li>
          <code>POST /api/webhooks/:vendor</code>
        </li>
        <li>
          <code>GET /api/health</code>
        </li>
      </ul>
      <p style={{ color: "#666" }}>A checkout UI will land here next.</p>
    </main>
  )
}
