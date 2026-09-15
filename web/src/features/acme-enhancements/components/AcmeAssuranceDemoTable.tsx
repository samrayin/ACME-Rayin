import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Badge } from "@/src/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/src/components/ui/table";
import { api } from "@/src/utils/api";

function RiskBadge({ tier }: { tier: "LOW" | "MEDIUM" | "HIGH" }) {
  if (tier === "HIGH") return <Badge variant="error">High</Badge>;
  if (tier === "MEDIUM") return <Badge variant="warning">Medium</Badge>;
  return <Badge variant="success">Low</Badge>;
}

function ActiveBadge({ active, label }: { active: boolean; label: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border p-3">
      <span className="text-sm">{label}</span>
      <Badge variant={active ? "success" : "secondary"}>
        {active ? "Active" : "Off"}
      </Badge>
    </div>
  );
}

export function AcmeAssuranceDemoTable({ projectId }: { projectId: string }) {
  const assets = api.acmeAssuranceDemo.demoAssets.useQuery({ projectId });
  const assurance = api.acmeAssuranceDemo.liveAssurance.useQuery({ projectId });

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Residual Assurance — measured, live
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Pulled from rayin-guardrails right now, not cached or assumed.
            Applies at the deployment level today — per-asset assurance is
            planned future work, not yet built.
          </p>
          {assurance.isLoading ? (
            <p className="text-sm text-muted-foreground">Checking live status…</p>
          ) : assurance.data && "configured" in assurance.data && assurance.data.configured ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <ActiveBadge
                active={assurance.data.jailbreak_enabled}
                label="Jailbreak detection"
              />
              <ActiveBadge
                active={assurance.data.topical_enabled}
                label="Topical rail"
              />
              <ActiveBadge
                active={assurance.data.pii_entities.length > 0}
                label={`PII redaction (${assurance.data.pii_entities.length} entity types)`}
              />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              rayin-guardrails is not configured for this deployment.
            </p>
          )}
          {assurance.data && "checkedAt" in assurance.data && (
            <p className="mt-3 text-xs text-muted-foreground">
              Checked at {new Date(assurance.data.checkedAt).toLocaleString()}.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Inherent Risk — declared, illustrative
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Hand-classified for this demo using real IT Ops prompts already
            live in this project — not a database, not discovered
            automatically. This is what the future Asset Inventory's
            registration form would capture from an asset owner.
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Asset</TableHead>
                <TableHead>Data sensitivity</TableHead>
                <TableHead>Business criticality</TableHead>
                <TableHead>Decision impact</TableHead>
                <TableHead>External-facing</TableHead>
                <TableHead>Inherent risk</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assets.data?.map((asset) => (
                <TableRow key={asset.slug}>
                  <TableCell>
                    <div className="font-medium">{asset.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {asset.description}
                    </div>
                  </TableCell>
                  <TableCell>{asset.dataSensitivity}</TableCell>
                  <TableCell>{asset.businessCriticality}</TableCell>
                  <TableCell>{asset.decisionImpact}</TableCell>
                  <TableCell>{asset.externalFacing ? "Yes" : "No"}</TableCell>
                  <TableCell>
                    <RiskBadge tier={asset.inherentRiskTier} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
