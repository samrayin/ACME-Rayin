import { useRouter } from "next/router";
import Page from "@/src/components/layouts/page";
import {
  TabsBar,
  TabsBarContent,
  TabsBarList,
  TabsBarTrigger,
} from "@/src/components/ui/tabs-bar";
import { AcmeAuditLogsTable } from "@/src/features/acme-enhancements/components/AcmeAuditLogsTable";
import { AcmeGuardrailEventsLog } from "@/src/features/acme-enhancements/components/AcmeGuardrailsTable";
import { EventsTab as AcmeGatewayChangeRecord } from "@/src/features/acme-enhancements/components/AcmeLitellmGateway";
import { AcmeLitellmRequestLogs } from "@/src/features/acme-enhancements/components/AcmeLitellmRequestLogs";
import { useHasProjectAccess } from "@/src/features/rbac/utils/checkProjectAccess";
import useProjectIdFromURL from "@/src/hooks/useProjectIdFromURL";
import { api } from "@/src/utils/api";

const headerProps = {
  title: "Logs",
  help: {
    description:
      "Security > Logs: the project's audit log, guardrail decisions, and the " +
      "LLM gateway's change record and request log, in one place.",
  },
};

const TABS = ["audit", "guardrails", "gateway-changes", "gateway-requests"];

/**
 * ACME (CHG-2026-073): Security > Logs. One page, one tab per log, each tab
 * shown only to roles that may read it. The same components and procedures
 * as before; only their home moved.
 */
function AcmeSecurityLogs({ projectId }: { projectId: string }) {
  const router = useRouter();
  const canReadAudit = useHasProjectAccess({
    projectId,
    scope: "projectAuditLogs:read",
  });
  const canReadGuardrails = useHasProjectAccess({
    projectId,
    scope: "projectGuardrails:read",
  });
  const canReadGatewayLogs = useHasProjectAccess({
    projectId,
    scope: "llmGatewayLogs:read",
  });
  const gateway = api.acmeLitellm.status.useQuery(
    { projectId },
    { enabled: canReadGatewayLogs, staleTime: 60_000, retry: false },
  );
  const gatewayOn =
    canReadGatewayLogs &&
    gateway.data?.enabled === true &&
    gateway.data.configured === true;
  const requestsOn = gatewayOn && gateway.data?.requestLogsEnabled === true;

  const visible = [
    canReadAudit && "audit",
    canReadGuardrails && "guardrails",
    gatewayOn && "gateway-changes",
    requestsOn && "gateway-requests",
  ].filter(Boolean) as string[];

  if (visible.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        {canReadGatewayLogs && gateway.isLoading
          ? "Loading…"
          : "You do not have access to any logs in this project."}
      </p>
    );
  }

  const requested =
    typeof router.query.tab === "string" ? router.query.tab : undefined;
  const current =
    requested && TABS.includes(requested) && visible.includes(requested)
      ? requested
      : visible[0]!;

  return (
    <TabsBar
      value={current}
      onValueChange={(tab) => {
        router
          .replace({ query: { ...router.query, tab } }, undefined, {
            shallow: true,
          })
          .catch(() => {});
      }}
    >
      <TabsBarList>
        {canReadAudit ? (
          <TabsBarTrigger value="audit">Audit logs</TabsBarTrigger>
        ) : null}
        {canReadGuardrails ? (
          <TabsBarTrigger value="guardrails">Guardrail events</TabsBarTrigger>
        ) : null}
        {gatewayOn ? (
          <TabsBarTrigger value="gateway-changes">
            Gateway changes
          </TabsBarTrigger>
        ) : null}
        {requestsOn ? (
          <TabsBarTrigger value="gateway-requests">
            Gateway requests
          </TabsBarTrigger>
        ) : null}
      </TabsBarList>
      {canReadAudit ? (
        <TabsBarContent value="audit" className="mt-6">
          <AcmeAuditLogsTable projectId={projectId} />
        </TabsBarContent>
      ) : null}
      {canReadGuardrails ? (
        <TabsBarContent value="guardrails" className="mt-6">
          <AcmeGuardrailEventsLog projectId={projectId} />
        </TabsBarContent>
      ) : null}
      {gatewayOn ? (
        <TabsBarContent value="gateway-changes" className="mt-6">
          <AcmeGatewayChangeRecord projectId={projectId} />
        </TabsBarContent>
      ) : null}
      {requestsOn ? (
        <TabsBarContent value="gateway-requests" className="mt-6">
          <AcmeLitellmRequestLogs projectId={projectId} />
        </TabsBarContent>
      ) : null}
    </TabsBar>
  );
}

export default function AcmeSecurityLogsPage() {
  const projectId = useProjectIdFromURL();
  return (
    <Page headerProps={headerProps} scrollable withPadding>
      {projectId ? <AcmeSecurityLogs projectId={projectId} /> : null}
    </Page>
  );
}
