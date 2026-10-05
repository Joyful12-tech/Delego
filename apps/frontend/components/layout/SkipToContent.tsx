"use client";

import { useTranslations } from "next-intl";

export function SkipToContent() {
  const t = useTranslations("a11y");

  return (
    <a
      href="#app-content"
      className="skip-to-content"
      data-testid="skip-to-content"
    >
      {t("skipToContent")}
    </a>
  );
}