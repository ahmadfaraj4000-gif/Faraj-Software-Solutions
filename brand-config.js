import { brand } from "./shared/brand.js";
window.REIMAGE_BRAND = brand;
document.addEventListener("DOMContentLoaded", () => {
  const b = window.REIMAGE_BRAND;
  document.querySelectorAll("[data-brand-link]").forEach((a) => {
    a.href =
      a.dataset.brandLink === "contact"
        ? "mailto:" + b.contactEmail
        : b[a.dataset.brandLink];
  });
});
