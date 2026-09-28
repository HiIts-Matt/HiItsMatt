import { env } from "../env.js";
import { createStore } from "./documents.js";

/** The one store the server reads and writes; see `env.dataStore`. */
export const store = createStore(env.dataStore);
