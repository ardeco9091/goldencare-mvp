import { ImageResponse } from "next/og";

export const alt =
  "GoldenCare — Asistencia y Acompañamiento para Personas Mayores en San Pedro de Jujuy";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "56px 68px",
          background:
            "linear-gradient(135deg, #0f172a 0%, #0c2340 52%, #082f49 100%)",
          color: "#ffffff",
          fontFamily: "sans-serif",
          position: "relative",
        }}
      >
        {/* Acento luminoso superior derecho */}
        <div
          style={{
            position: "absolute",
            top: "-120px",
            right: "-90px",
            width: "440px",
            height: "440px",
            borderRadius: "9999px",
            background:
              "radial-gradient(circle, rgba(56,189,248,0.28) 0%, rgba(6,182,212,0.06) 55%, rgba(8,47,73,0) 75%)",
            display: "flex",
          }}
        />

        {/* Fila superior: Logo + Badge */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "18px" }}>
            <div
              style={{
                width: "68px",
                height: "68px",
                borderRadius: "20px",
                background: "linear-gradient(135deg, #38bdf8 0%, #06b6d4 100%)",
                color: "#0f172a",
                fontSize: "38px",
                fontWeight: 900,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 12px 30px rgba(6, 182, 212, 0.35)",
              }}
            >
              G
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                padding: "10px 20px",
                borderRadius: "9999px",
                border: "1px solid rgba(56, 189, 248, 0.45)",
                background: "rgba(6, 182, 212, 0.14)",
                color: "#7dd3fc",
                fontSize: "18px",
                fontWeight: 700,
                letterSpacing: "2px",
              }}
            >
              SAN PEDRO DE JUJUY · PLATAFORMA EN TIEMPO REAL
            </div>
          </div>
        </div>

        {/* Bloque central: Título y Subtítulo */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "20px",
            maxWidth: "980px",
          }}
        >
          <div
            style={{
              fontSize: "88px",
              fontWeight: 900,
              letterSpacing: "-2px",
              lineHeight: 1.02,
              color: "#ffffff",
              display: "flex",
            }}
          >
            GoldenCare
          </div>
          <div
            style={{
              fontSize: "34px",
              fontWeight: 500,
              lineHeight: 1.32,
              color: "#cbd5e1",
              display: "flex",
            }}
          >
            Cuidado, traslados y acompañamiento confiable para personas mayores
          </div>
        </div>

        {/* Tres píldoras inferiores */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "18px",
            width: "100%",
          }}
        >
          {[
            "🚗 Traslados Seguros",
            "🤝 Compañía Domiciliaria",
            "📍 Seguimiento en Vivo",
          ].map((pilar) => (
            <div
              key={pilar}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "16px 26px",
                borderRadius: "18px",
                background: "rgba(255, 255, 255, 0.08)",
                border: "1px solid rgba(56, 189, 248, 0.35)",
                color: "#f8fafc",
                fontSize: "22px",
                fontWeight: 700,
              }}
            >
              {pilar}
            </div>
          ))}
        </div>
      </div>
    ),
    {
      ...size,
    },
  );
}
