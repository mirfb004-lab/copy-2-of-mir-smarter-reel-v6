import { Moon, Palette, Sun, Volume2, VolumeX } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { THEME_OPTIONS, useTheme, type ColorTheme } from "@/components/theme-provider";

const themeSwatches: Record<ColorTheme, string> = {
  aurora: "from-emerald-400 via-cyan-300 to-orange-300",
  sapphire: "from-blue-600 via-sky-400 to-indigo-300",
  terracotta: "from-orange-500 via-rose-400 to-amber-200",
  plum: "from-violet-700 via-fuchsia-500 to-pink-300",
  gold: "from-amber-500 via-yellow-300 to-stone-200",
};

export function ThemeSettings() {
  const { colorTheme, mode, soundEnabled, setColorTheme, setMode, setSoundEnabled } = useTheme();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Palette className="h-4 w-4 text-primary" /> Appearance</CardTitle>
        <CardDescription>Choose the visual language for your workspace. Preferences are saved on this device.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label>Color theme</Label>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {THEME_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={colorTheme === option.id}
                onClick={() => setColorTheme(option.id)}
                className={cn(
                  "group rounded-xl border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  colorTheme === option.id ? "border-primary bg-primary/10 shadow-sm" : "border-border bg-background/60 hover:border-primary/50",
                )}
              >
                <span className={cn("mb-2 block h-8 rounded-lg bg-gradient-to-r shadow-inner", themeSwatches[option.id])} />
                <span className="block text-sm font-medium">{option.label}</span>
                <span className="block text-xs text-muted-foreground">{option.description}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex items-center justify-between rounded-xl border border-border bg-background/60 p-3">
            <div className="flex items-center gap-3">
              {mode === "dark" ? <Moon className="h-4 w-4 text-primary" /> : <Sun className="h-4 w-4 text-primary" />}
              <div><Label htmlFor="theme-mode">Dark mode</Label><p className="text-xs text-muted-foreground">Use a low-glare palette.</p></div>
            </div>
            <Switch id="theme-mode" checked={mode === "dark"} onCheckedChange={(checked) => setMode(checked ? "dark" : "light")} />
          </div>
          <div className="flex items-center justify-between rounded-xl border border-border bg-background/60 p-3">
            <div className="flex items-center gap-3">
              {soundEnabled ? <Volume2 className="h-4 w-4 text-primary" /> : <VolumeX className="h-4 w-4 text-muted-foreground" />}
              <div><Label htmlFor="notification-sounds">Notification sounds</Label><p className="text-xs text-muted-foreground">Optional, off by default.</p></div>
            </div>
            <Switch id="notification-sounds" checked={soundEnabled} onCheckedChange={setSoundEnabled} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
