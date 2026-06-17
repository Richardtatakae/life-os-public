"use client"

/**
 * /ui-preview — throwaway gallery for the consolidated UI primitives.
 * NOT part of the app; safe to delete once the new system is proven.
 * Lets you see Button/Card/Panel/Input/Badge/Progress/Switch on the real
 * theme tokens and give specific feedback before any screen is converted.
 */

import { useState } from "react"
import { Plus, Check, Star } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card"
import { Panel } from "@/components/ui/panel"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </section>
  )
}

export default function UiPreviewPage() {
  const [on, setOn] = useState(true)

  return (
    <main className="mx-auto max-w-3xl px-8 py-12">
      <header className="mb-10">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          UI Primitives — Preview
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The new single system, on your real theme tokens. State stays on the
          blue ↔ amber axis (never red-vs-green).
        </p>
      </header>

      <div className="flex flex-col gap-10">
        <Section title="Buttons">
          <Button>
            <Plus /> Primary
          </Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="success">
            <Check /> Success
          </Button>
          <Button variant="destructive">Danger (amber)</Button>
          <Button variant="link">Link</Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
        </Section>

        <Section title="Badges / chips">
          <Badge>Default</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="outline">Outline</Badge>
          <Badge variant="success">
            <Star className="size-3" /> On track
          </Badge>
          <Badge variant="warning">Overdue</Badge>
        </Section>

        <Section title="Inputs">
          <div className="flex w-full max-w-sm flex-col gap-2">
            <Label htmlFor="demo">Goal name</Label>
            <Input id="demo" placeholder="e.g. Ship Life OS v1" />
          </div>
        </Section>

        <Section title="Progress">
          <div className="flex w-full max-w-sm flex-col gap-3">
            <Progress value={28} />
            <Progress value={64} />
            <Progress value={100} />
          </div>
        </Section>

        <Section title="Switch">
          <div className="flex items-center gap-3">
            <Switch checked={on} onCheckedChange={setOn} id="sw" />
            <Label htmlFor="sw">{on ? "Enabled" : "Disabled"}</Label>
          </div>
        </Section>

        <Section title="Card vs Panel">
          <Card className="w-64">
            <CardHeader>
              <CardTitle>Card (bordered)</CardTitle>
              <CardDescription>Clear edge against the page.</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Use when a widget needs a defined boundary.
            </CardContent>
            <CardFooter className="gap-2">
              <Button size="sm">Save</Button>
              <Button size="sm" variant="ghost">
                Cancel
              </Button>
            </CardFooter>
          </Card>

          <Panel className="w-64">
            <div className="font-semibold">Panel (floating)</div>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Soft elevation, no hard rim — for in-page sections.
            </p>
          </Panel>
        </Section>

        <Section title="Empty state (on purpose)">
          <Card className="w-full">
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-secondary">
                <Plus className="text-muted-foreground" />
              </div>
              <div>
                <div className="font-semibold text-foreground">No goals yet</div>
                <div className="text-sm text-muted-foreground">
                  Add your first goal to start tracking progress.
                </div>
              </div>
              <Button size="sm">
                <Plus /> New goal
              </Button>
            </CardContent>
          </Card>
        </Section>
      </div>
    </main>
  )
}
