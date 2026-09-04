import type { CSSProperties } from "react";
import type { LanguageStat } from "server";

import styles from "./LanguageBar.module.css";

type LanguageBarProps = {
  languages: LanguageStat[];
  /** Long tails of sub-1% languages are noise; the rest folds into "Other". */
  limit?: number;
};

/** How far along the pink -> navy ramp the last segment sits, in percent. */
const RAMP_END = 72;

export function LanguageBar({ languages, limit = 6 }: LanguageBarProps) {
  const top = languages.slice(0, limit);
  const restShare = languages.slice(limit).reduce((sum, language) => sum + language.share, 0);
  const segments =
    restShare > 0.005 ? [...top, { name: "Other", bytes: 0, share: restShare }] : top;

  const stopFor = (index: number): CSSProperties =>
    ({ "--stop": segments.length > 1 ? (index / (segments.length - 1)) * RAMP_END : 0 }) as CSSProperties;

  return (
    <div className={styles.wrap}>
      <div className={styles.bar}>
        {segments.map((language, index) => (
          <span
            key={language.name}
            className={styles.segment}
            style={{ ...stopFor(index), width: `${(language.share * 100).toFixed(2)}%` }}
          />
        ))}
      </div>

      <ul className={styles.list}>
        {segments.map((language, index) => (
          <li key={language.name} className={styles.item}>
            <span className={styles.swatch} style={stopFor(index)} />
            {language.name}
            <span className={styles.share}>{(language.share * 100).toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
