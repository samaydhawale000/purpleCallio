import Link from "next/link";
import { ContentSection } from "./PublicPage";
import { CodeBlock } from "./InteractiveTools";
import { PricingAuthority } from "../PricingAuthority";
import {
   AI_BROWSER_EXAMPLE,
   AI_ERROR_CODES,
   AI_LIMITS,
   AI_REACT_COMPONENT_EXAMPLE,
   AI_REACT_HOOK_EXAMPLE,
   AI_SECURITY_NOTES,
   AI_SERVER_SESSION_EXAMPLE,
   AI_SSRF_RULES,
   AI_TOOL_HEADERS,
   AI_TOOL_REQUEST_BODY,
   AI_TOOL_SCHEMA_EXAMPLE,
   AI_TOOL_SCHEMA_RULES,
   AI_TOOL_SIGNATURE_EXAMPLE,
} from "../../lib/ai-docs";

function List({ items }: { items: string[] }) {
   return (
      <ul className="list-disc space-y-2 pl-5">
         {items.map((item) => (
            <li key={item}>{item}</li>
         ))}
      </ul>
   );
}

function Table({ head, rows }: { head: [string, string]; rows: [string, string][] }) {
   return (
      <div className="overflow-x-auto rounded-xl border border-[#E7DFF5]">
         <table className="w-full text-left text-sm">
            <thead className="bg-[#F8F4FD] text-xs uppercase tracking-wider text-[#3D3650]">
               <tr>
                  <th scope="col" className="px-4 py-3">{head[0]}</th>
                  <th scope="col" className="px-4 py-3">{head[1]}</th>
               </tr>
            </thead>
            <tbody className="text-[#3D3650]">
               {rows.map(([a, b]) => (
                  <tr key={a} className="border-t border-[#E7DFF5]">
                     <td className="px-4 py-3 font-mono text-xs text-[#170B2E]">{a}</td>
                     <td className="px-4 py-3">{b}</td>
                  </tr>
               ))}
            </tbody>
         </table>
      </div>
   );
}

/** Extra content for /docs/ai-agents, below the overview sections. */
export function AiAgentsDoc() {
   return (
      <>
         <section id="tools" className="scroll-mt-24">
            <ContentSection title="Tools: the JSON-schema subset">
               <p>
                  Each tool declares its arguments with a small JSON-schema subset
                  that every voice model provider can represent:
               </p>
               <List items={AI_TOOL_SCHEMA_RULES} />
               <CodeBlock code={AI_TOOL_SCHEMA_EXAMPLE} filename="parameters.json" />
            </ContentSection>
         </section>
         <section id="server-session" className="scroll-mt-24">
            <ContentSection title="Create a session on your server">
               <p>
                  <code>client.ai.createSession()</code> returns{" "}
                  <code>{"{ sessionId, callId, token, expiresAt, connectUrl }"}</code>.
                  Send only the <code>token</code> to the browser.
               </p>
               <CodeBlock code={AI_SERVER_SESSION_EXAMPLE} filename="server.ts" />
            </ContentSection>
         </section>
         <section id="browser-sdk" className="scroll-mt-24">
            <ContentSection title="Browser SDK">
               <p>
                  <code>PurpleCallioAgentCall</code> opens the microphone, streams
                  audio to PurpleCallio and plays the agent&apos;s reply. Tokens are
                  single-use: create a new session for every call.
               </p>
               <CodeBlock code={AI_BROWSER_EXAMPLE} filename="agent-call.ts" />
            </ContentSection>
         </section>
         <section id="react" className="scroll-mt-24">
            <ContentSection title="React hook and component">
               <p>
                  <code>@purplecallio/react</code> 0.2 adds{" "}
                  <code>usePurpleCallioAI</code> and a ready-made{" "}
                  <code>&lt;PurpleCallioAI /&gt;</code>. Both call your{" "}
                  <code>getToken</code> on every start, so your API key stays on
                  your server.
               </p>
               <CodeBlock code={AI_REACT_HOOK_EXAMPLE} filename="SupportAgent.tsx" />
               <CodeBlock code={AI_REACT_COMPONENT_EXAMPLE} filename="SupportWidget.tsx" />
               <p>
                  Style the component with <code>className</code> and the{" "}
                  <code>bj-ai</code>, <code>bj-ai-status</code>,{" "}
                  <code>bj-ai-indicator</code>, <code>bj-ai-controls</code>,{" "}
                  <code>bj-ai-error</code>, <code>bj-ai-confirm</code> and{" "}
                  <code>bj-ai-transcript</code> classes.
               </p>
            </ContentSection>
         </section>
         <section id="tool-signatures" className="scroll-mt-24">
            <ContentSection title="Verify tool requests">
               <p>
                  PurpleCallio calls your tool endpoint with a signed request. POST
                  tools receive this JSON body; GET tools receive the same JSON,
                  URL-encoded, in the <code>payload</code> query parameter, and that
                  string is what is signed. Dashboard test calls have{" "}
                  <code>sessionId</code> and <code>callId</code> set to null and{" "}
                  <code>&quot;test&quot;: true</code>.
               </p>
               <CodeBlock code={AI_TOOL_REQUEST_BODY} filename="request.json" />
               <Table head={["Header", "Value"]} rows={AI_TOOL_HEADERS} />
               <p>
                  Reply with <code>Content-Type: application/json</code>; the agent
                  sees your JSON as the tool result.
               </p>
               <CodeBlock code={AI_TOOL_SIGNATURE_EXAMPLE} filename="tools.js" />
            </ContentSection>
         </section>
         <section id="ssrf" className="scroll-mt-24">
            <ContentSection title="Tool endpoint network rules">
               <List items={AI_SSRF_RULES} />
            </ContentSection>
         </section>
         <section id="pricing" className="scroll-mt-24">
            <ContentSection title="Availability and pricing">
               <p>
                  AI voice agents are available after an eligible credit purchase. AI calls are billed in credits
                  per minute of call time (not per participant), rounded up once
                  per call. A session cannot start without enough credits, and an
                  active call is never cut off if the wallet runs low. Sessions that
                  fail to connect are not billed.{" "}
                  <Link href="/pricing" className="text-[#6425C4] underline">
                     See credit pricing
                  </Link>
                  .
               </p>
               <PricingAuthority />
            </ContentSection>
         </section>
         <section id="errors" className="scroll-mt-24">
            <ContentSection title="Error codes">
               <p>
                  Errors are returned as <code>{"{ code, message }"}</code> and
                  surface in the SDK as an <code>Error</code> with a stable{" "}
                  <code>code</code>.
               </p>
               <Table head={["Code", "Meaning"]} rows={AI_ERROR_CODES} />
            </ContentSection>
         </section>
         <section id="limits" className="scroll-mt-24">
            <ContentSection title="Limits">
               <p>Default limits; contact support if you need higher ones.</p>
               <Table head={["Limit", "Default"]} rows={AI_LIMITS} />
            </ContentSection>
         </section>
         <section id="security-notes" className="scroll-mt-24">
            <ContentSection title="Security notes">
               <List items={AI_SECURITY_NOTES} />
            </ContentSection>
         </section>
      </>
   );
}
