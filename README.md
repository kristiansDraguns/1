# BTC trend lines

Log-scale Bitfinex BTCUSD chart with the three trend lines kept from the OpticalArt trendline method, and fib circles whose handles sit on those lines. A ring is kept when the same circle level meets more than one wick. Log scale stays on.

```bash
python3 -m http.server 8765
```

Open `http://127.0.0.1:8765/`. Log scale stays on. Drag pans the chart and the scroll wheel zooms. Neither one refits the lines. 1D, 4H, and 1H use the same slopes.
