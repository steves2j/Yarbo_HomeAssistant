class S2JYarboControlCard extends window.S2JYarboBaseCard {
  constructor() {
    super();
    this._cardMode = "control";
  }
}

if (!customElements.get("s2jyarbo-control-card")) {
  customElements.define("s2jyarbo-control-card", S2JYarboControlCard);
}

window.customCards = window.customCards || [];
if (!window.customCards.some((card) => card.type === "s2jyarbo-control-card")) {
  window.customCards.push({
    type: "s2jyarbo-control-card",
    name: "S2JYarbo Control",
    description: "S2JYarbo serial, battery, signal, plan, and control card.",
    preview: false,
  });
}
