import { useState } from "preact/hooks";

import type { FunctionComponent } from "preact";

import type { Dataset } from "../model/types";
import { defineStat } from "./registry";
import { Beat } from "./shared/reveal";
import { hourOfWeek } from "./shared/time";

const HOURS_PER_DAY = 24;
const DAYS_PER_WEEK = 7;
const SLOT_COUNT = HOURS_PER_DAY * DAYS_PER_WEEK; // 168

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export interface ActivityHeatmapResult {
  slots: number[]; // length 168, index = weekday * 24 + hour (weekday 0 = Monday)
  busiestSlot: { weekday: number; hour: number; count: number };
  peakHour: number; // 0–23, hour-of-day with the most messages across all days
  peakWeekday: number; // 0–6, weekday with the most messages across all hours
}

function argmax(values: number[]): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i] > values[best]) best = i;
  }
  return best;
}

function compute(dataset: Dataset): ActivityHeatmapResult {
  const tz = dataset.meta.timezone;
  const slots = new Array<number>(SLOT_COUNT).fill(0);

  for (const message of dataset.messages) {
    slots[hourOfWeek(message.timestamp, tz)]++;
  }

  const busiestIndex = argmax(slots);
  const busiestSlot = {
    weekday: Math.floor(busiestIndex / HOURS_PER_DAY),
    hour: busiestIndex % HOURS_PER_DAY,
    count: slots[busiestIndex],
  };

  const byHour = new Array<number>(HOURS_PER_DAY).fill(0);
  const byWeekday = new Array<number>(DAYS_PER_WEEK).fill(0);
  for (let i = 0; i < SLOT_COUNT; i++) {
    byHour[i % HOURS_PER_DAY] += slots[i];
    byWeekday[Math.floor(i / HOURS_PER_DAY)] += slots[i];
  }

  return {
    slots,
    busiestSlot,
    peakHour: argmax(byHour),
    peakWeekday: argmax(byWeekday),
  };
}

interface HoveredSlot {
  weekday: number;
  hour: number;
  count: number;
}

const Card: FunctionComponent<{ result: ActivityHeatmapResult }> = ({
  result,
}) => {
  const max = result.busiestSlot.count;
  // Native title tooltips can't be styled — show hovered-cell details in the
  // readout line under the grid instead (contribution-graph style).
  const [hovered, setHovered] = useState<HoveredSlot | null>(null);

  return (
    <div class="stat-heatmap">
      <Beat step={0}>
        <div class="stat-heatmap__grid" onMouseLeave={() => setHovered(null)}>
          <div class="stat-heatmap__row" aria-hidden="true">
            <span class="stat-heatmap__label" />
            {Array.from({ length: HOURS_PER_DAY }, (_, hour) => (
              <span class="stat-heatmap__hour" key={hour}>
                {/* Every 3rd hour — 24 labels would collide at this cell width. */}
                {hour % 3 === 0 ? `${hour}:00` : ""}
              </span>
            ))}
          </div>
          {Array.from({ length: DAYS_PER_WEEK }, (_, weekday) => (
            <div class="stat-heatmap__row" key={weekday}>
              <span class="stat-heatmap__label">
                {WEEKDAY_LABELS[weekday]}
              </span>
              {Array.from({ length: HOURS_PER_DAY }, (_, hour) => {
                const count = result.slots[weekday * HOURS_PER_DAY + hour];
                const intensity = max > 0 ? count / max : 0;
                return (
                  <span
                    class="stat-heatmap__cell"
                    key={hour}
                    onMouseEnter={() => setHovered({ weekday, hour, count })}
                    style={{
                      backgroundColor: `color-mix(in srgb, var(--accent) ${Math.round(intensity * 100)}%, transparent)`,
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </Beat>
      <Beat step={1}>
        <p class="stat-heatmap__summary">
          {hovered
            ? `${WEEKDAY_LABELS[hovered.weekday]} ${hovered.hour}:00–${(hovered.hour + 1) % 24}:00 · ${hovered.count} ${hovered.count === 1 ? "message" : "messages"}`
            : max > 0
              ? `Busiest: ${WEEKDAY_LABELS[result.busiestSlot.weekday]} around ${result.busiestSlot.hour}:00`
              : "No activity yet"}
        </p>
      </Beat>
    </div>
  );
};

export const activityHeatmap = defineStat<ActivityHeatmapResult>({
  id: "activity-heatmap",
  title: "When you're awake",
  icon: "🕐",
  description: "Your busiest hours of the day and days of the week.",
  compute,
  Card,
});
