import test from "node:test";
import assert from "node:assert/strict";
import { languageFromName, textToVtt } from "../js/playback.js";

test("converts srt and ass cues and reads a language suffix", () => {
  const vtt = textToVtt("1\n00:00:01,000 --> 00:00:04,000\nHello\n");
  assert.match(vtt, /00:00:01\.000 --> 00:00:04\.000/);
  assert.match(vtt, /Hello/);
  const ass = textToVtt("[Script Info]\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:03.50,Default,,0,0,0,,Hello {\\i1}there\n");
  assert.match(ass, /00:00:01\.000 --> 00:00:03\.500/);
  assert.match(ass, /Hello there/);
  assert.equal(languageFromName("Movie.en.srt").label, "English");
  assert.equal(languageFromName("Show.S01E02.hin.srt").label, "Hindi");
});
