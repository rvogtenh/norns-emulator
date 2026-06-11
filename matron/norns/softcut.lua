-- softcut.lua — norns softcut API forwarded to the browser AudioWorklet.
-- Phase 4: real DSP runs in web/js/softcut-worklet.js; this module
-- translates every softcut.* call into a {t:"softcut",...} host message.

local host = require("norns.host")

local softcut = {}
softcut.VOICE_COUNT = 6
softcut.BUFFER_SIZE = 350

local phase_cb  = nil
local render_cb = nil

local function sc(cmd, voice, args)
  host.send({ t = "softcut", cmd = cmd, voice = voice, args = args })
end

-- ── voice playback / recording ────────────────────────────────────────────
function softcut.play(v, f)         sc("play", v, {f}) end
function softcut.rec(v, f)          sc("rec",  v, {f}) end
function softcut.enable(v, f)       sc("enable", v, {f}) end  -- alias for play

-- ── position / rate ───────────────────────────────────────────────────────
function softcut.rate(v, r)         sc("rate",     v, {r}) end
function softcut.position(v, p)     sc("position", v, {p}) end

-- ── loop ──────────────────────────────────────────────────────────────────
function softcut.loop(v, f)         sc("loop",       v, {f}) end
function softcut.loop_start(v, p)   sc("loop_start", v, {p}) end
function softcut.loop_end(v, p)     sc("loop_end",   v, {p}) end

-- ── levels ────────────────────────────────────────────────────────────────
function softcut.level(v, l)        sc("level",     v, {l}) end
function softcut.rec_level(v, l)    sc("rec_level", v, {l}) end
function softcut.pre_level(v, l)    sc("pre_level", v, {l}) end
function softcut.fade_time(v, t)    sc("fade_time", v, {t}) end
function softcut.rec_offset(v, o)   sc("rec_offset", v, {o}) end

-- ── stereo / routing ──────────────────────────────────────────────────────
function softcut.pan(v, p)                  sc("pan",    v, {p}) end
function softcut.buffer(v, ch)              sc("buffer", v, {ch}) end
function softcut.level_input_cut(ch, v, l)  sc("level_input_cut", v, {ch, l}) end
function softcut.level_cut_cut(src, dst, l) sc("level_cut_cut", 0, {src, dst, l}) end
function softcut.level_adc_cut(ch, v, l)    sc("level_adc_cut", v, {ch, l}) end
function softcut.level_cut_dac(v, ch, l)    sc("level_cut_dac", v, {ch, l}) end

-- ── slew ──────────────────────────────────────────────────────────────────
function softcut.level_slew_time(v, t)   sc("level_slew_time",  v, {t}) end
function softcut.pan_slew_time(v, t)     sc("pan_slew_time",    v, {t}) end
function softcut.rate_slew_time(v, t)    sc("rate_slew_time",   v, {t}) end
function softcut.recpre_slew_time(v, t)  sc("recpre_slew_time", v, {t}) end

-- ── pre-filter (input state-variable filter) ──────────────────────────────
function softcut.pre_filter_dry(v, a)  sc("pre_filter_dry",  v, {a}) end
function softcut.pre_filter_lp(v, a)   sc("pre_filter_lp",   v, {a}) end
function softcut.pre_filter_hp(v, a)   sc("pre_filter_hp",   v, {a}) end
function softcut.pre_filter_bp(v, a)   sc("pre_filter_bp",   v, {a}) end
function softcut.pre_filter_br(v, a)   sc("pre_filter_br",   v, {a}) end
function softcut.pre_filter_fc(v, f)   sc("pre_filter_fc",   v, {f}) end
function softcut.pre_filter_rq(v, q)   sc("pre_filter_rq",   v, {q}) end

-- ── post-filter (state-variable) ──────────────────────────────────────────
function softcut.post_filter_lp(v, a)   sc("post_filter_lp",  v, {a}) end
function softcut.post_filter_hp(v, a)   sc("post_filter_hp",  v, {a}) end
function softcut.post_filter_bp(v, a)   sc("post_filter_bp",  v, {a}) end
function softcut.post_filter_br(v, a)   sc("post_filter_br",  v, {a}) end
function softcut.post_filter_dry(v, a)  sc("post_filter_dry", v, {a}) end
function softcut.post_filter_fc(v, f)   sc("post_filter_fc",  v, {f}) end
function softcut.post_filter_rq(v, q)   sc("post_filter_rq",  v, {q}) end
function softcut.filter_dry(v, a)       sc("filter_dry",      v, {a}) end
-- Short aliases used by older scripts (halfsecond, etc.)
function softcut.filter_fc(v, f)        sc("post_filter_fc",  v, {f}) end
function softcut.filter_rq(v, q)        sc("post_filter_rq",  v, {q}) end
function softcut.filter_lp(v, a)        sc("post_filter_lp",  v, {a}) end
function softcut.filter_hp(v, a)        sc("post_filter_hp",  v, {a}) end
function softcut.filter_bp(v, a)        sc("post_filter_bp",  v, {a}) end
function softcut.filter_br(v, a)        sc("post_filter_br",  v, {a}) end

-- ── buffer ops ────────────────────────────────────────────────────────────
function softcut.buffer_clear()
  sc("buffer_clear", 0, {})
end
function softcut.buffer_clear_channel(ch)
  sc("buffer_clear_channel", 0, {ch})
end
function softcut.buffer_clear_region(s, len)
  sc("buffer_clear_region", 0, {s, len})
end
function softcut.buffer_clear_region_channel(ch, s, len)
  sc("buffer_clear_region_channel", 0, {ch, s, len})
end
function softcut.buffer_read_mono(file, src, dst, dur, ch_src, ch_dst)
  sc("buffer_read_mono", 0, {file, src or 0, dst or 0, dur or -1, ch_src or 1, ch_dst or 1})
end
function softcut.buffer_read_stereo(file, src, dst, dur)
  sc("buffer_read_stereo", 0, {file, src or 0, dst or 0, dur or -1})
end
function softcut.buffer_write_mono(file, s, dur, ch)
  sc("buffer_write_mono", 0, {file, s or 0, dur or -1, ch or 1})
end
function softcut.buffer_write_stereo(file, s, dur)
  sc("buffer_write_stereo", 0, {file, s or 0, dur or -1})
end

-- ── voice sync & offset ───────────────────────────────────────────────────
function softcut.voice_sync(src, dst, offset)
  sc("voice_sync", 0, {src, dst, offset or 0})
end
function softcut.phase_offset(v, offset)
  sc("phase_offset", v, {offset or 0})
end

-- ── buffer copy ───────────────────────────────────────────────────────────
function softcut.buffer_copy_mono(ch_src, ch_dst, start_src, start_dst, dur, fade)
  sc("buffer_copy_mono", 0, {ch_src or 1, ch_dst or 1, start_src or 0, start_dst or 0, dur or -1, fade or 0})
end

-- ── waveform rendering ────────────────────────────────────────────────────
-- render_buffer(ch, start_sec, dur_sec, n_samples): request a downsampled
-- amplitude snapshot of the buffer for waveform display. The result is
-- delivered asynchronously via event_render callback.
function softcut.render_buffer(ch, start, dur, n)
  sc("render_buffer", 0, {ch or 1, start or 0, dur or 1, n or 128})
end
function softcut.event_render(fn) render_cb = fn end

function softcut._dispatch_render(ch, start, samples)
  if type(render_cb) == "function" then
    pcall(render_cb, ch, start, 1, samples)
  end
end

-- ── lifecycle reset ───────────────────────────────────────────────────────
-- Stops all voices and clears per-voice state. Buffer data is preserved
-- (matching norns behaviour: the buffer survives script reloads).
function softcut.reset_all()
  sc("reset_all", 0, {})
end

-- ── phase polling ─────────────────────────────────────────────────────────
function softcut.phase_quant(v, q)     sc("phase_quant",     v, {q}) end
function softcut.poll_start_phase()    sc("poll_start_phase", 0, {}) end
function softcut.poll_stop_phase()     sc("poll_stop_phase",  0, {}) end
function softcut.event_phase(fn)       phase_cb = fn end
softcut.event_position = softcut.event_phase  -- common alias

-- called by matron.lua when a softcut_phase message arrives from the browser
function softcut._dispatch_phase(v, pos)
  if type(phase_cb) == "function" then
    pcall(phase_cb, v, pos)
  end
end

return softcut
