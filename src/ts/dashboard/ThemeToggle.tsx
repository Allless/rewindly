import { useEffect, useState } from "preact/hooks";

import BulbIcon from "../../icons/bulb.svg?react";
import MoonIcon from "../../icons/moon.svg?react";
import {
  browserPrefersDark,
  isDarkApplied,
  onSchemeChange,
  setSchemePref,
} from "../theme";

/** Day/night toggle; the icon shows the mode a click switches to. */
export function ThemeToggle() {
  const [dark, setDark] = useState(isDarkApplied);
  useEffect(() => onSchemeChange(() => setDark(isDarkApplied())), []);
  const flip = () => {
    const targetDark = !dark;
    // Smart reset: landing on the browser's own scheme means "auto" — only
    // deliberate disagreement with the system is stored.
    if (targetDark === browserPrefersDark()) {
      setSchemePref("auto");
    } else {
      setSchemePref(targetDark ? "dark" : "light");
    }
    setDark(targetDark);
  };
  const target = dark ? "light" : "dark";
  return (
    <button
      type="button"
      class="btn-secondary btn-icon"
      title={`Switch to ${target} theme`}
      aria-label={`Switch to ${target} theme`}
      onClick={flip}
    >
      {dark ? <BulbIcon /> : <MoonIcon />}
    </button>
  );
}
