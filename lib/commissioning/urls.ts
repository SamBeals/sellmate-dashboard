/**
 * Absolute http(s) origin helpers for FEATURE-013 commissioning transports.
 *
 * Browser fetch() treats strings without a scheme as relative to the current
 * dashboard route. Concatenating `192.168.0.181` + `/commissioning/status`
 * from `/machines/machine_001/commissioning` becomes:
 *   /machines/machine_001/192.168.0.181/commissioning/status
 */

export type JoinApiUrlOptions = {
  /** Used when the operator entered a host without an explicit port. */
  defaultPort?: number;
};

export function stripTrailingSlash(value: string): string {
  const trimmed = value.trim();
  // Do not turn `http://` into `http:/` while the operator is still typing.
  if (/^https?:\/\/$/i.test(trimmed)) return trimmed;
  return trimmed.replace(/\/$/, "");
}

export function normalizeApiOrigin(
  raw: string,
  options: JoinApiUrlOptions = {}
): string {
  const trimmed = stripTrailingSlash(raw);
  if (!trimmed) {
    throw new Error("Commissioning base URL is missing");
  }

  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error(`Invalid commissioning base URL: ${raw}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `Commissioning base URL must be http(s), not ${parsed.protocol}`
    );
  }

  if (
    options.defaultPort &&
    parsed.protocol === "http:" &&
    parsed.port === "" &&
    parsed.hostname !== "localhost" &&
    parsed.hostname !== "127.0.0.1"
  ) {
    parsed.port = String(options.defaultPort);
  }

  return parsed.origin;
}

export function joinApiUrl(
  base: string,
  path: string,
  options: JoinApiUrlOptions = {}
): string {
  const origin = normalizeApiOrigin(base, options);
  const suffix = path.startsWith("/") ? path : `/${path}`;
  const joined = new URL(suffix, `${origin}/`);

  if (joined.origin !== origin) {
    throw new Error("Commissioning URL escaped the configured origin");
  }
  if (joined.protocol !== "http:" && joined.protocol !== "https:") {
    throw new Error("Commissioning URL must be http(s)");
  }
  return joined.toString();
}

export function assertAbsoluteHttpUrl(url: string): void {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error(
      `Refusing relative commissioning URL '${url}'. Local Wi-Fi requires a full http://host:port origin.`
    );
  }
}
