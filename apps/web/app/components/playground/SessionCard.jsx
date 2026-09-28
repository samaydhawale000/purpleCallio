"use client";

import QRCode from "react-qr-code";
import {
  Copy,
  Smartphone,
  ExternalLink,
  CheckCircle2,
  Monitor,
} from "lucide-react";

export default function SessionCard({
  session,
  onCopy,
  onOpenCaller,
  onOpenReceiver,
}) {
  return (
    <div
      className="mt-10 rounded-3xl border overflow-hidden"
      style={{
        background: "#FFFFFF",
        borderColor: "#E7DFF5",
      }}
    >
      {/* Header */}

      <div
        className="px-8 py-6 border-b"
        style={{
          borderColor: "#E7DFF5",
        }}
      >
        <h2 className="text-2xl font-semibold text-[#170B2E]">
          Demo Session Ready
        </h2>

        <p className="text-[#3D3650] mt-2">
          Scan the QR code using your phone or open the receiver in another
          browser.
        </p>
      </div>

      <div className="grid lg:grid-cols-[320px_1fr]">

        {/* LEFT */}

        <div
          className="p-8 flex flex-col items-center"
          style={{
            borderRight: "1px solid #E7DFF5",
          }}
        >
          <div className="bg-white rounded-xl p-4">

            <QRCode
              value={session.receiverUrl}
              size={220}
            />

          </div>

          <p className="text-[#3D3650] text-sm mt-6 text-center">
            Scan to join as Receiver
          </p>

          <button
            onClick={onOpenReceiver}
            className="mt-6 w-full rounded-xl py-3 text-white"
            style={{
              background:
                "linear-gradient(135deg,#7F40E8,#410686)",
            }}
          >
            Open Receiver
          </button>
        </div>

        {/* RIGHT */}

        <div className="p-8">

          <div className="space-y-8">

            {/* Caller */}

            <div>

              <div className="flex items-center justify-between mb-3">

                <div className="flex items-center gap-2">

                  <Monitor size={18} color="#7F40E8" />

                  <h3 className="text-[#170B2E] font-medium">
                    Caller
                  </h3>

                </div>

                <button
                  onClick={onOpenCaller}
                  className="text-[#6425C4] flex items-center gap-2"
                >
                  Open

                  <ExternalLink size={15} />

                </button>

              </div>

              <div
                className="rounded-xl p-4 flex items-center justify-between"
                style={{
                  background: "#F8F4FD",
                }}
              >
                <span className="text-[#3D3650] truncate mr-4">
                  {session.callerUrl}
                </span>

                <button
                  onClick={() => onCopy(session.callerUrl)}
                >
                  <Copy
                    size={18}
                    color="#3D3650"
                  />
                </button>

              </div>

            </div>

            {/* Receiver */}

            <div>

              <div className="flex items-center gap-2 mb-3">

                <Smartphone
                  size={18}
                  color="#7F40E8"
                />

                <h3 className="text-[#170B2E] font-medium">
                  Receiver
                </h3>

              </div>

              <div
                className="rounded-xl p-4 flex items-center justify-between"
                style={{
                  background: "#F8F4FD",
                }}
              >
                <span className="text-[#3D3650] truncate mr-4">
                  {session.receiverUrl}
                </span>

                <button
                  onClick={() => onCopy(session.receiverUrl)}
                >
                  <Copy
                    size={18}
                    color="#3D3650"
                  />
                </button>

              </div>

            </div>

            {/* Status */}

            <div
              className="rounded-xl p-5"
              style={{
                background: "#F8F4FD",
              }}
            >
              <div className="flex items-center gap-3">

                <CheckCircle2
                  color="#10B981"
                  size={20}
                />

                <div>

                  <p className="text-[#170B2E]">
                    Session Created Successfully
                  </p>

                  <p className="text-[#3D3650] text-sm">
                    Waiting for participants to join...
                  </p>

                </div>

              </div>

            </div>

          </div>

        </div>

      </div>

    </div>
  );
}