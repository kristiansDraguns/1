# BTC trend lines

Log-scale Bitfinex BTCUSD chart with the three trend lines kept from the OpticalArt trendline method (repeated support and resistance on one slope, anchored on wicks, checked against older price, and still relevant to the October 2026 price).

```bash
python3 -m http.server 8765
```

Open `http://127.0.0.1:8765/`. Log scale stays on. Drag pans the chart and the scroll wheel zooms. Neither one refits the lines. 1D, 4H, and 1H use the same slopes.
