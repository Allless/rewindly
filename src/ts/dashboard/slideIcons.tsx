import VolumeOverTimeIcon from "../../icons/slides/volume-over-time.svg?react";
import ActivityHeatmapIcon from "../../icons/slides/activity-heatmap.svg?react";
import TopDmsIcon from "../../icons/slides/top-dms.svg?react";
import TopGroupsIcon from "../../icons/slides/top-groups.svg?react";
import StreaksIcon from "../../icons/slides/streaks.svg?react";
import ResponseTimesIcon from "../../icons/slides/response-times.svg?react";
import WhoTextsFirstIcon from "../../icons/slides/who-texts-first.svg?react";
import LeftOnReadIcon from "../../icons/slides/left-on-read.svg?react";
import GhostedChatsIcon from "../../icons/slides/ghosted-chats.svg?react";
import NightOwlsIcon from "../../icons/slides/night-owls.svg?react";
import TextingStylesIcon from "../../icons/slides/texting-styles.svg?react";
import EmojiCultureIcon from "../../icons/slides/emoji-culture.svg?react";
import GreatestHitsIcon from "../../icons/slides/greatest-hits.svg?react";
import MediaRotationIcon from "../../icons/slides/media-rotation.svg?react";
import TrophyShelfIcon from "../../icons/slides/trophy-shelf.svg?react";
import ShareIcon from "../../icons/slides/share.svg?react";
import HeadlineIcon from "../../icons/slides/headline.svg?react";

import type { FunctionComponent, JSX } from "preact";

/** Slide id → its rail/header icon component. Keyed by the same ids as `STAT_REGISTRY`
 * plus the dashboard-only slides (media-rotation, share, headline). */
export const SLIDE_ICONS: Record<
  string,
  FunctionComponent<JSX.SVGAttributes<SVGSVGElement>>
> = {
  "volume-over-time": VolumeOverTimeIcon,
  "activity-heatmap": ActivityHeatmapIcon,
  "top-dms": TopDmsIcon,
  "top-groups": TopGroupsIcon,
  streaks: StreaksIcon,
  "response-times": ResponseTimesIcon,
  "who-texts-first": WhoTextsFirstIcon,
  "left-on-read": LeftOnReadIcon,
  "ghosted-chats": GhostedChatsIcon,
  "night-owls": NightOwlsIcon,
  "texting-styles": TextingStylesIcon,
  "emoji-culture": EmojiCultureIcon,
  "greatest-hits": GreatestHitsIcon,
  "media-rotation": MediaRotationIcon,
  "trophy-shelf": TrophyShelfIcon,
  share: ShareIcon,
  headline: HeadlineIcon,
};

/** Renders a slide's SVG icon when one exists, falling back to its emoji otherwise. */
export function SlideIcon({
  id,
  fallback,
}: {
  id: string;
  fallback: string;
}) {
  const Icon = SLIDE_ICONS[id];
  return Icon ? <Icon /> : <>{fallback}</>;
}
