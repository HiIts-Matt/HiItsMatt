import { Link } from "react-router";

import styles from "./NotFound.module.css";

export function NotFound() {
  return (
    <main className={styles.wrap}>
      <p className={styles.code}>404</p>
      <h1 className={styles.title}>
        Nothing here
      </h1>
      <Link className={styles.link} to="/">
        Back to the start
      </Link>
    </main>
  );
}
