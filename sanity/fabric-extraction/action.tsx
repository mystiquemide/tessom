import imageUrlBuilder from "@sanity/image-url";
import {SparklesIcon} from "@sanity/icons/Sparkles";
import {Badge, Box, Button, Card, Flex, Stack, Text, TextInput} from "@sanity/ui";
import {useToast} from "@sanity/ui/toast";
import {useMemo, useState} from "react";
import {
  type DocumentActionComponent,
  type DocumentActionDescription,
  type DocumentActionProps,
  type DocumentActionsResolver,
  set,
  useDataset,
  useDocumentOperation,
  useProjectId,
} from "sanity";

import type {FabricExtraction} from "../../lib/groq/fabric-extraction";
import {
  buildFabricExtractionUpdate,
  hasApplicableSuggestion,
  type RemnantExtractionValues,
} from "./update";

type RemnantDocument = RemnantExtractionValues & {
  photo?: unknown;
};

type ExtractionDialogProps = {
  current: RemnantExtractionValues;
  imageUrl: string;
  onApply: (extraction: FabricExtraction) => void;
  onClose: () => void;
};

function displayValue(value: string | number | boolean | null): string {
  if (value === null) return "Not found";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function responseLooksValid(value: unknown): value is FabricExtraction {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  const nullableString = (candidate: unknown) => candidate === null || typeof candidate === "string";
  const nullableNumber = (candidate: unknown) => candidate === null || typeof candidate === "number";
  return nullableString(result.fabricName) &&
    nullableString(result.maker) &&
    nullableNumber(result.repeatVerticalCm) &&
    nullableNumber(result.repeatHorizontalCm) &&
    (result.directional === null || typeof result.directional === "boolean") &&
    (result.confidence === "low" || result.confidence === "medium" || result.confidence === "high") &&
    typeof result.evidence === "string";
}

function ExtractionDialog({current, imageUrl, onApply, onClose}: ExtractionDialogProps) {
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FabricExtraction | null>(null);

  async function extract() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/studio/fabric-extraction", {
        method: "POST",
        headers: {"content-type": "application/json", "x-workshop-pin": pin},
        body: JSON.stringify({imageUrl}),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const message = body && typeof body === "object" && typeof (body as {error?: unknown}).error === "string"
          ? (body as {error: string}).error
          : "Unable to read this photo";
        throw new Error(message);
      }
      if (!responseLooksValid(body)) throw new Error("The extraction response was incomplete");
      setResult(body);
    } catch (cause) {
      setResult(null);
      setError(cause instanceof Error ? cause.message : "Unable to read this photo");
    } finally {
      setLoading(false);
    }
  }

  const update = result ? buildFabricExtractionUpdate(current, result) : {};

  return (
    <Box padding={4}>
      <Stack gap={4}>
        <Text size={1} muted>
          Tessom reads only printed selvage details. It leaves uncertain values blank and never changes the document until you review the result.
        </Text>

        <Stack gap={2}>
          <Text as="label" htmlFor="fabric-extraction-pin" size={1} weight="semibold">Workshop PIN</Text>
          <TextInput
            autoComplete="current-password"
            id="fabric-extraction-pin"
            onChange={(event) => setPin(event.currentTarget.value)}
            type="password"
            value={pin}
          />
        </Stack>

        <Button
          disabled={pin.trim().length === 0}
          icon={SparklesIcon}
          loading={loading}
          onClick={extract}
          text={loading ? "Reading selvage…" : "Read selvage"}
          tone="primary"
        />

        {error && (
          <Card padding={3} radius={2} tone="critical">
            <Text size={1}>{error}</Text>
          </Card>
        )}

        {result && (
          <Card border padding={4} radius={2}>
            <Stack gap={4}>
              <Flex align="center" gap={3} justify="space-between">
                <Text weight="semibold">Suggestions</Text>
                <Badge tone={result.confidence === "high" ? "positive" : result.confidence === "medium" ? "caution" : "default"}>
                  {result.confidence} confidence
                </Badge>
              </Flex>

              <Stack gap={3}>
                <Suggestion label="Fabric name" value={displayValue(result.fabricName)} />
                <Suggestion label="Maker" value={displayValue(result.maker)} />
                <Suggestion label="Vertical repeat" value={result.repeatVerticalCm === null ? "Not found" : `${result.repeatVerticalCm} cm`} />
                <Suggestion label="Horizontal repeat" value={result.repeatHorizontalCm === null ? "Not found" : `${result.repeatHorizontalCm} cm`} />
                <Suggestion label="Directional" value={displayValue(result.directional)} />
              </Stack>

              <Card padding={3} radius={2} tone="transparent">
                <Stack gap={2}>
                  <Text size={1} weight="semibold">Visible evidence</Text>
                  <Text size={1} muted>{result.evidence}</Text>
                </Stack>
              </Card>

              <Text size={1} muted>
                Review each suggestion before applying. Existing values stay unchanged when the result says “Not found.”
              </Text>

              <Flex gap={2} justify="flex-end">
                <Button mode="ghost" onClick={onClose} text="Cancel" />
                <Button
                  disabled={!hasApplicableSuggestion(result) || Object.keys(update).length === 0}
                  onClick={() => onApply(result)}
                  text="Apply suggestions"
                  tone="primary"
                />
              </Flex>
            </Stack>
          </Card>
        )}
      </Stack>
    </Box>
  );
}

function Suggestion({label, value}: {label: string; value: string}) {
  return (
    <Flex align="baseline" gap={3} justify="space-between">
      <Text size={1} muted>{label}</Text>
      <Text size={1} weight="medium">{value}</Text>
    </Flex>
  );
}

export function ReadSelvagePhotoAction(props: DocumentActionProps): DocumentActionDescription | null {
  const [open, setOpen] = useState(false);
  const projectId = useProjectId();
  const dataset = useDataset();
  const toast = useToast();
  const operations = useDocumentOperation(props.id, props.type);
  const document = (props.draft ?? props.version ?? props.published) as RemnantDocument | null;
  const imageUrl = useMemo(() => {
    if (!document?.photo) return null;
    try {
      return imageUrlBuilder({projectId, dataset})
        .image(document.photo as never)
        .width(2_000)
        .fit("max")
        .auto("format")
        .url();
    } catch {
      return null;
    }
  }, [dataset, document?.photo, projectId]);

  if (props.type !== "remnant") return null;

  const apply = (extraction: FabricExtraction) => {
    const update = buildFabricExtractionUpdate(document ?? {}, extraction);
    const patches = Object.entries(update).map(([field, value]) => set(value, [field]));
    if (patches.length === 0 || operations.patch.disabled) return;
    operations.patch.execute(patches);
    toast.push({status: "success", title: "Fabric suggestions applied to the draft"});
    setOpen(false);
  };

  return {
    disabled: !imageUrl || Boolean(operations.patch.disabled),
    icon: SparklesIcon,
    label: "Read selvage photo",
    title: imageUrl ? "Extract printed fabric details from the remnant photo" : "Add a remnant photo first",
    onHandle: () => setOpen(true),
    dialog: open && imageUrl ? {
      type: "dialog",
      header: "Read selvage photo",
      content: (
        <ExtractionDialog
          current={document ?? {}}
          imageUrl={imageUrl}
          onApply={apply}
          onClose={() => setOpen(false)}
        />
      ),
      onClose: () => setOpen(false),
      showCloseButton: true,
      width: "small",
    } : false,
  };
}

ReadSelvagePhotoAction.displayName = "ReadSelvagePhotoAction";

export const resolveFabricExtractionActions: DocumentActionsResolver = (previous, context) => (
  context.schemaType === "remnant" ? [...previous, ReadSelvagePhotoAction as DocumentActionComponent] : previous
);
