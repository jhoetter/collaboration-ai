/**
 * Lightweight i18n types. We deliberately avoid pulling in
 * `react-intl` / `next-intl`: the catalogues live as plain JSON next
 * to the consumer code so swapping engines later means rewriting the
 * tiny `useTranslator` hook, not 200 call-sites.
 */
export type Locale = "en" | "de";

export const SUPPORTED_LOCALES: ReadonlyArray<Locale> = ["en", "de"] as const;
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "collabai.locale";

/**
 * Catalogue shape: `{ [namespace]: { [key]: string | nested } }`.
 * Strings may contain `{name}` ICU-light placeholders which `t(key, vars)`
 * substitutes at format time.
 */
export type MessageNode = string | { readonly [key: string]: MessageNode };
export type Messages = Readonly<Record<string, MessageNode>>;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && SUPPORTED_LOCALES.includes(value as Locale);
}
