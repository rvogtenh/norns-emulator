// midi.js — WebMIDI bridge. Incoming -> onIn(data); outgoing via send().
//
// Permission strategy:
//   autoConnect() — called on boot; tries silently. On Chrome this shows the
//   browser dialog automatically. On Firefox (108+) the dialog only appears
//   in response to a user gesture, so a SecurityError here means we need a
//   connect button. The caller sets onNeedPermission to handle that.
//
//   connect() — call this from a button click (user gesture). Firefox will
//   then show the permission dialog correctly.

export class MidiBridge {
  constructor(onIn, log) {
    this.onIn   = onIn;
    this.log    = log || (() => {});
    this.access = null;
    this.input  = null;
    this.output = null;
    this.onNeedPermission = null;  // set by caller to show connect button
    this._inSel  = null;
    this._outSel = null;
  }

  // Called on boot. Works immediately on Chrome; on Firefox may need a gesture.
  async autoConnect(inSelect, outSelect) {
    this._inSel  = inSelect;
    this._outSel = outSelect;
    if (!navigator.requestMIDIAccess) {
      this.log("WebMIDI not supported in this browser");
      return;
    }
    try {
      this.access = await navigator.requestMIDIAccess();
      this._ready();
    } catch (e) {
      if (e.name === "SecurityError") {
        // Firefox: permission requires user gesture — signal caller to show button
        if (this.onNeedPermission) this.onNeedPermission();
      } else {
        this.log("MIDI: " + (e.message || String(e)));
      }
    }
  }

  // Call this from a button click (user gesture — required by Firefox).
  async connect() {
    if (!navigator.requestMIDIAccess) return;
    try {
      this.access = await navigator.requestMIDIAccess();
      this._ready();
      // hide connect button if caller wired it
      if (this.onConnected) this.onConnected();
    } catch (e) {
      if (e.name === "SecurityError") {
        this.log("MIDI: permission denied — click the ℹ icon left of the URL → MIDI-Geräte → Erlauben → reload");
      } else {
        this.log("MIDI: " + (e.message || String(e)));
      }
    }
  }

  _ready() {
    const { _inSel: inSelect, _outSel: outSelect } = this;
    this._populate(inSelect, outSelect);
    this.access.onstatechange = () => this._populate(inSelect, outSelect);
    inSelect.addEventListener("change", () => this.setInput(inSelect.value));
    outSelect.addEventListener("change", () => this.setOutput(outSelect.value));
    this.log("MIDI ready");
  }

  _populate(inSelect, outSelect) {
    const fill = (sel, ports) => {
      const cur = sel.value;
      sel.innerHTML = '<option value="">— none —</option>';
      for (const p of ports.values()) {
        const o = document.createElement("option");
        o.value = p.id; o.textContent = p.name;
        sel.appendChild(o);
      }
      sel.value = cur;
    };
    fill(inSelect,  this.access.inputs);
    fill(outSelect, this.access.outputs);
  }

  setInput(id) {
    if (this.input) this.input.onmidimessage = null;
    this.input = id ? this.access.inputs.get(id) : null;
    if (this.input) {
      this.input.onmidimessage = (e) => this.onIn(Array.from(e.data));
      this.log("MIDI in: " + this.input.name);
    }
  }

  setOutput(id) {
    this.output = id ? this.access.outputs.get(id) : null;
    if (this.output) this.log("MIDI out: " + this.output.name);
  }

  send(data) {
    if (this.output) this.output.send(data);
  }
}
