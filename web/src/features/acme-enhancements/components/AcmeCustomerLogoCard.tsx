import { useRef, useState } from "react";
import { Info, Upload } from "lucide-react";
import { api } from "@/src/utils/api";
import { showErrorToast, showSuccessToast } from "@/src/features/notifications";
import { Button } from "@/src/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/src/components/ui/card";
import {
  ACME_LOGO_DISPLAY,
  ACME_LOGO_LIMITS,
  ACME_LOGO_TYPES,
  type AcmeLogoType,
} from "@/src/features/acme-enhancements/server/acmeCustomerLogoCheck";

// ACME (CHG-2026-124, ADR-0025): "Add Logo" on the UI Customization page. The
// organization's Owners and Admins upload the customer's own logo; everyone in
// the organization sees it beside EYEON in the sidebar. The server checks the
// file again (type from its own header, size, dimensions); the checks here
// only give a quick answer before the upload.

/** The size requirement, shown as a small note beside the upload. */
export const ACME_LOGO_SIZE_NOTE =
  `PNG, JPEG or WebP, up to ${ACME_LOGO_LIMITS.maxBytes / 1024} KB, ` +
  `${ACME_LOGO_LIMITS.minHeight} to ${ACME_LOGO_LIMITS.maxHeight} px high. ` +
  `It is shown ${ACME_LOGO_DISPLAY.heightPx} px high and up to ` +
  `${ACME_LOGO_DISPLAY.maxWidthPx} px wide on a white tile, so a logo no ` +
  `wider than 3:1, about 48 to 96 px high, with a transparent or white ` +
  `background works best.`;

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the file."));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

function imageHeight(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img.naturalHeight);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("The file is not an image this browser can read."));
    };
    img.src = url;
  });
}

/** The quick pre-check; null when the file may be uploaded. */
async function precheck(file: File): Promise<string | null> {
  if (!(ACME_LOGO_TYPES as readonly string[]).includes(file.type)) {
    return "Use a PNG, JPEG or WebP image.";
  }
  if (file.size > ACME_LOGO_LIMITS.maxBytes) {
    return `The file is ${Math.ceil(file.size / 1024)} KB; the limit is ${ACME_LOGO_LIMITS.maxBytes / 1024} KB.`;
  }
  const height = await imageHeight(file);
  if (height < ACME_LOGO_LIMITS.minHeight) {
    return `The image is ${height} px high; it must be at least ${ACME_LOGO_LIMITS.minHeight} px.`;
  }
  return null;
}

/** How the sidebar header will look, on the sidebar's own colours. */
function SidebarPreview({ src }: { src?: string }) {
  return (
    <div className="bg-sidebar flex h-11 w-46 items-center gap-2 rounded-md px-3">
      {src ? (
        <div className="flex h-8 shrink-0 items-center rounded-md bg-white px-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt="Organization logo preview"
            className="max-h-6 max-w-18 object-contain"
          />
        </div>
      ) : null}
      <span
        // eslint-disable-next-line @repo/no-raw-font-weight
        className={`${src ? "text-xl" : "text-2xl"} leading-none font-extrabold tracking-wide text-white`}
      >
        EYE<span className="text-sidebar-accent-foreground">ON</span>
      </span>
    </div>
  );
}

export function AcmeCustomerLogoCard({
  orgId,
  canEdit,
}: {
  orgId: string;
  canEdit: boolean;
}) {
  const utils = api.useUtils();
  const input = useRef<HTMLInputElement>(null);
  const [checking, setChecking] = useState(false);
  const logo = api.acmeCustomerLogo.get.useQuery({ orgId });

  const onDone = (title: string, description: string) => {
    utils.acmeCustomerLogo.get.invalidate({ orgId }).catch(() => {});
    showSuccessToast({ title, description });
  };
  const upload = api.acmeCustomerLogo.upload.useMutation({
    onSuccess: () =>
      onDone(
        "Logo updated",
        "Everyone in this organization now sees it beside EYEON.",
      ),
    onError: (error) => showErrorToast("Logo not uploaded", error.message),
  });
  const remove = api.acmeCustomerLogo.remove.useMutation({
    onSuccess: () =>
      onDone("Logo removed", "The sidebar shows EYEON on its own again."),
    onError: (error) => showErrorToast("Logo not removed", error.message),
  });
  const busy = checking || upload.isPending || remove.isPending;

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setChecking(true);
    try {
      const problem = await precheck(file);
      if (problem) {
        showErrorToast("Logo not uploaded", problem);
        return;
      }
      upload.mutate({
        orgId,
        contentType: file.type as AcmeLogoType,
        dataBase64: await readAsBase64(file),
      });
    } catch (error) {
      showErrorToast(
        "Logo not uploaded",
        error instanceof Error ? error.message : "Could not read the file.",
      );
    } finally {
      setChecking(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add Logo</CardTitle>
        <CardDescription>
          Your organization&apos;s logo, shown beside EYEON at the top of the
          sidebar for everyone in this organization.
          {canEdit ? "" : " Only organization owners and admins can change it."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <SidebarPreview src={logo.data?.src} />
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={input}
            type="file"
            accept={ACME_LOGO_TYPES.join(",")}
            className="hidden"
            aria-label="Logo file"
            onChange={(e) => {
              // onFile reports its own errors as toasts.
              onFile(e.target.files?.[0]).catch(() => {});
            }}
          />
          <Button
            size="sm"
            disabled={!canEdit || busy}
            onClick={() => input.current?.click()}
          >
            <Upload className="mr-1 h-4 w-4" />
            {logo.data ? "Replace logo" : "Upload logo"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!canEdit || busy || !logo.data}
            onClick={() => remove.mutate({ orgId })}
          >
            Remove
          </Button>
          {logo.data ? (
            <span className="text-muted-foreground text-xs">
              {logo.data.width} × {logo.data.height} px,{" "}
              {Math.ceil(logo.data.sizeBytes / 1024)} KB
            </span>
          ) : null}
        </div>
        <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
          <Info className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>{ACME_LOGO_SIZE_NOTE}</span>
        </p>
      </CardContent>
    </Card>
  );
}
