"use client";

import { useEffect, useRef, useState } from "react";

type VersionResponse = {
  success: boolean;
  data?: {
    version?: string;
    shortVersion?: string;
  };
};

const pollIntervalMs = 60_000;

async function fetchAppVersion() {
  const response = await fetch("/api/app-version", {
    cache: "no-store",
    headers: {
      "Cache-Control": "no-cache"
    }
  });

  if (!response.ok) {
    throw new Error("Unable to check app version.");
  }

  const payload = await response.json() as VersionResponse;
  return payload.data?.version ?? "";
}

export function NewVersionPrompt() {
  const loadedVersionRef = useRef<string | null>(null);
  const [hasNewVersion, setHasNewVersion] = useState(false);

  useEffect(() => {
    let active = true;
    let interval: ReturnType<typeof setInterval> | null = null;

    async function checkVersion() {
      try {
        const version = await fetchAppVersion();
        if (!active || !version) {
          return;
        }

        if (!loadedVersionRef.current) {
          loadedVersionRef.current = version;
          setHasNewVersion(false);
          return;
        }

        setHasNewVersion(version !== loadedVersionRef.current);
      } catch {
        // Silent retry on the next poll; update checks should never interrupt admin work.
      }
    }

    void checkVersion();
    interval = setInterval(() => void checkVersion(), pollIntervalMs);

    return () => {
      active = false;
      if (interval) {
        clearInterval(interval);
      }
    };
  }, []);

  if (!hasNewVersion) {
    return null;
  }

  return (
    <button type="button" className="app-version-prompt" onClick={() => window.location.reload()} aria-live="polite">
      <strong>New updates are available.</strong>
      <span>Click here to refresh the app.</span>
    </button>
  );
}
