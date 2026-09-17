import { useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard, ListVideo, Table2, Brain, LogOut, Sparkles, TrendingUp,
  Cable, Wand2, Search, Clock, SlidersHorizontal, FolderKanban, Menu, Globe, Repeat2, Sun, Moon, Gauge,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { CampaignSelector } from "@/components/campaign-selector";
import { InstructionsDialog } from "@/components/instructions-dialog";
import { ActiveCampaignProvider, useCampaignScope } from "@/components/campaign-context";
import { Badge } from "@/components/ui/badge";
import { useTheme } from "@/components/theme-provider";

const UNLOCK_KEY = "loop:unlocked";

const nav = [
  { to: "/global-dashboard", label: "Global", icon: Globe },
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/campaigns", label: "Campaigns", icon: FolderKanban },
  { to: "/queue", label: "Queue", icon: ListVideo },
  { to: "/sheet", label: "Sheet", icon: Table2 },
  { to: "/sheet-mode", label: "Sheet Mode", icon: Table2 },
  { to: "/learning", label: "Learning", icon: Brain },
  { to: "/insights", label: "Insights", icon: TrendingUp },
  { to: "/reel-formula", label: "1 Reel Formula", icon: Repeat2 },
  { to: "/usage", label: "Usage & Activity", icon: Gauge },
];


const settingsNav = [
  { to: "/settings/buffer", label: "Buffer", icon: Cable },
  { to: "/settings/ai", label: "AI", icon: Wand2 },
  { to: "/settings/analysis", label: "Analysis", icon: Search },
  { to: "/settings/scheduler", label: "Scheduler", icon: Clock },
  { to: "/settings/general", label: "General", icon: SlidersHorizontal },
];

function SidebarContent({ onNavigate, onLock }: { onNavigate?: () => void; onLock: () => void }) {
  const location = useLocation();
  return (
    <div className="flex flex-col h-full">
      <div className="p-4 flex items-center gap-2 border-b border-sidebar-border">
        <div className="h-8 w-8 rounded-md bg-primary/15 flex items-center justify-center shrink-0">
          <Sparkles className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate">Loop</div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">Adaptive Publisher</div>
        </div>
      </div>

      <div className="px-3 pt-3 space-y-2">
        <GlobalModeButton onNavigate={onNavigate} />
        <ThemeModeButton />
      </div>

      <div className="px-3 pt-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Campaign</div>
        <CampaignSelector />
      </div>

      <nav className="p-3 space-y-1">
        {nav.map((item) => {
          const active = location.pathname === item.to || location.pathname.startsWith(item.to + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="px-3 mt-2 mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Settings</div>
      <nav className="p-3 pt-1 space-y-1">
        {settingsNav.map((item) => {
          const active = location.pathname === item.to;
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto p-3 border-t border-sidebar-border">
        <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => { onNavigate?.(); onLock(); }}>
          <LogOut className="h-4 w-4 mr-2" /> Sign out
        </Button>
      </div>
    </div>
  );
}

function GlobalModeButton({ onNavigate }: { onNavigate?: () => void }) {
  const { mode, setMode } = useCampaignScope();
  const navigate = useNavigate();
  return (
    <Button
      variant={mode === "global" ? "default" : "outline"}
      size="sm"
      className="w-full justify-start"
      onClick={() => {
        setMode(mode === "global" ? "campaign" : "global");
        onNavigate?.();
        if (mode !== "global") navigate({ to: "/global-dashboard" });
      }}
    >
      <Globe className="h-4 w-4 mr-2" />
      {mode === "global" ? "Global Mode: on" : "Main Global Dashboard"}
    </Button>
  );
}

function ThemeModeButton() {
  const { mode, toggleMode } = useTheme();
  const nextMode = mode === "dark" ? "light" : "dark";
  return (
    <Button variant="outline" size="sm" className="w-full justify-start" onClick={toggleMode} aria-label={`Switch to ${nextMode} mode`}>
      {mode === "dark" ? <Sun className="h-4 w-4 mr-2" /> : <Moon className="h-4 w-4 mr-2" />}
      {mode === "dark" ? "Light mode" : "Dark mode"}
    </Button>
  );
}

function ScopeBadge() {
  const { mode, activeCampaign } = useCampaignScope();
  return (
    <Badge variant={mode === "global" ? "default" : "secondary"} className="mr-auto">
      {mode === "global" ? "Global workspace — all campaigns" : `Campaign: ${activeCampaign?.name ?? "none selected"}`}
    </Badge>
  );
}

function AppShellInner({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  function lock() {
    if (typeof window !== "undefined") window.localStorage.removeItem(UNLOCK_KEY);
    navigate({ to: "/auth" });
  }

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-60 shrink-0 border-r border-sidebar-border bg-sidebar flex-col">
        <SidebarContent onLock={lock} />
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Mobile top bar */}
        <header className="md:hidden sticky top-0 z-30 flex items-center gap-2 border-b border-sidebar-border bg-sidebar/95 backdrop-blur px-3 py-2">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open menu">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-72 bg-sidebar border-sidebar-border">
              <SheetHeader className="sr-only"><SheetTitle>Navigation</SheetTitle></SheetHeader>
              <SidebarContent onNavigate={() => setOpen(false)} onLock={lock} />
            </SheetContent>
          </Sheet>
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className="h-7 w-7 rounded-md bg-primary/15 flex items-center justify-center shrink-0">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div className="text-sm font-semibold truncate">Loop</div>
          </div>
          <InstructionsDialog />
        </header>

        {/* Desktop top bar */}
        <header className="hidden md:flex sticky top-0 z-30 items-center gap-2 border-b border-sidebar-border bg-background/80 backdrop-blur px-6 py-2">
          <ScopeBadge />
          <InstructionsDialog />
        </header>

        <main className="flex-1 min-w-0 overflow-x-hidden">
          <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">{children}</div>
        </main>
      </div>

    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <ActiveCampaignProvider>
      <AppShellInner>{children}</AppShellInner>
    </ActiveCampaignProvider>
  );
}
