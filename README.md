# TV Card

A compact dark-glass Lovelace card for a TV in Home Assistant, with Greek labels and a visual editor.

- **Now and next:** the current programme with its times and a progress bar, plus what's on after it. This comes from an EPG sensor.
- **Channels:** each channel's logo, with what's on it right now. Tap one to switch to it (`media_player.select_source`).
- **Apps:** Netflix, YouTube, Stremio, Spotify and the rest of the source list.
- **Volume, mute and channel ±.**
- **Remote:** d-pad, OK, Back, Home, Menu and Info, through a `remote` entity (Android TV Remote).
- **Picture mode:** chips for a `select` entity.

## Install

In HACS, open ⋮ → Custom repositories, add this repo as type **Dashboard**, then click Download.

## Config

```yaml
type: custom:tv-card
entity: media_player.tcl_tv                  # required; channels and apps come from its source list
remote: remote.smart_tv                      # optional; enables the d-pad and channel keys
epg_entity: sensor.tv_programma              # optional; attributes shaped as { key: { channel, title, start, end, logo, next_title, next_start } }
picture_mode_entity: select.tv_picture_mode_75_picture_mode   # optional
title: TCL 75                                # optional; defaults to the device name
hide_sources: [Live Tv, Notify, Pipup, Android TV Launcher]
show_channels: true
show_apps: true
color_on: "linear-gradient(135deg, #1e3a8a, #7c3aed)"
color_off: "linear-gradient(135deg, #1f2937, #374151)"
```

A source counts as a channel when it matches an EPG entry or ends in "HD". Matching ignores accents, case and the words "HD" and "TV". Every other source counts as an app.

MIT License.
