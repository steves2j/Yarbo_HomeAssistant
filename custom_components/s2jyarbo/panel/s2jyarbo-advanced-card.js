class S2JYarboAdvancedCard extends window.S2JYarboBaseCard {
  constructor() {
    super();
    this._cardMode = "advanced";
  }
}

if (!customElements.get("s2jyarbo-advanced-card")) {
  customElements.define("s2jyarbo-advanced-card", S2JYarboAdvancedCard);
}

window.customCards = window.customCards || [];
if (!window.customCards.some((card) => card.type === "s2jyarbo-advanced-card")) {
  window.customCards.push({
    type: "s2jyarbo-advanced-card",
    name: "S2JYarbo Advanced",
    description: "S2JYarbo advanced status, firmware, diagnostics, and device controls.",
    preview: false,
  });
}
