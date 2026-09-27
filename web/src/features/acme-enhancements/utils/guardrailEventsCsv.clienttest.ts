import { describe, expect, it } from "vitest";
import { csvCell, guardrailEventsToCsv } from "./guardrailEventsCsv";

describe("guardrail events CSV", () => {
  it("never lets a caller-set value start as a spreadsheet formula", () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(
      '"\'=HYPERLINK(""http://x"")"',
    );
    expect(csvCell("+cmd")).toBe("'+cmd");
    expect(csvCell("-1+1")).toBe("'-1+1");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("\tx")).toBe("'\tx");
  });

  it("quotes commas, quotes and line breaks, and leaves plain text alone", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
    expect(csvCell("gateway-agent")).toBe("gateway-agent");
    expect(csvCell("محمد")).toBe("محمد");
    expect(csvCell(null)).toBe("");
  });

  it("writes the header and one CRLF-terminated line per event", () => {
    const csv = guardrailEventsToCsv([
      {
        time: "2026-09-24T10:00:00.000Z",
        action: "block",
        direction: "input",
        policy_triggered: "Jailbreak Detection",
        agent_id: "gateway",
        user_id: null,
        client_host: "=evil()",
        trace_id: null,
        event_id: "e1",
        source: "push",
      },
    ]);
    expect(csv).toBe(
      "event_time_utc,action,direction,policy_triggered,agent_id,user_id,client_host,trace_id,event_id,source\r\n" +
        "2026-09-24T10:00:00.000Z,block,input,Jailbreak Detection,gateway,,'=evil(),,e1,push\r\n",
    );
  });
});
