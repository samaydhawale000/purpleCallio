import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "PurpleCallio: video, audio, live translation and AI voice agent APIs for developers";

const pills = ["Video calls", "Audio calls", "Live Translate", "AI voice agents"];

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        height: "100%",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "72px 80px",
        color: "white",
        background: "radial-gradient(120% 120% at 0% 0%, #8B4DF0 0%, #5B1BB5 45%, #2B0F52 100%)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", fontSize: 36, fontWeight: 700 }}>
        <div
          style={{
            display: "flex",
            width: 52,
            height: 52,
            borderRadius: 16,
            background: "white",
            marginRight: 18,
            alignItems: "center",
            justifyContent: "center",
            color: "#5B1BB5",
            fontSize: 30,
          }}
        >
          P
        </div>
        PurpleCallio
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", fontSize: 70, fontWeight: 700, lineHeight: 1.08, maxWidth: 980, letterSpacing: "-0.02em" }}>
          Real-time calls, live translation and AI voice agents
        </div>
        <div style={{ display: "flex", marginTop: 36 }}>
          {pills.map((p) => (
            <div
              key={p}
              style={{
                display: "flex",
                fontSize: 26,
                padding: "10px 22px",
                marginRight: 14,
                borderRadius: 999,
                background: "rgba(255,255,255,0.16)",
                border: "1px solid rgba(255,255,255,0.3)",
              }}
            >
              {p}
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", fontSize: 26, color: "rgba(255,255,255,0.75)" }}>
        Hosted UI · React · Headless SDK · REST API · purplecallio.com
      </div>
    </div>,
    size,
  );
}
