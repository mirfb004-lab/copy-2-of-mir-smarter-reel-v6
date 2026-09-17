import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const FRAME_SAMPLING_PRESETS = [
  { value: 5, label: "High Detail — every 5s (~12 frames / 60s)" },
  { value: 10, label: "Standard (Recommended) — every 10s (~6 frames / 60s)" },
  { value: 20, label: "Fast / Key Points — every 20s (~3 frames / 60s)" },
] as const;

const PRESET_VALUES = FRAME_SAMPLING_PRESETS.map((p) => p.value) as readonly number[];

export function FrameSamplingFields({
  value,
  onChange,
}: {
  value: number;
  onChange: (seconds: number) => void;
}) {
  const isPreset = PRESET_VALUES.includes(value);

  return (
    <div className="space-y-2">
      <Label>AI Video Frame Sampling</Label>
      <Select
        value={isPreset ? String(value) : "custom"}
        onValueChange={(v) => onChange(v === "custom" ? value : Number(v))}
      >
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {FRAME_SAMPLING_PRESETS.map((p) => (
            <SelectItem key={p.value} value={String(p.value)}>{p.label}</SelectItem>
          ))}
          <SelectItem value="custom">Custom Step</SelectItem>
        </SelectContent>
      </Select>
      {!isPreset && (
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Sampling interval (seconds)</Label>
          <Input
            type="number"
            min={1}
            max={120}
            value={value}
            onChange={(e) => onChange(Math.min(120, Math.max(1, Number(e.target.value) || 10)))}
          />
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Frames are captured in your browser from the stored video — no Cloudinary transformations are used.
      </p>
    </div>
  );
}
