# Trading Strategy Reference

## Validated Strategies from Backtesting

### Hybrid Moonshot System (Validated)
- **Returns**: 850% simulated
- **Sharpe Ratio**: 1.12
- **Max Drawdown**: 31%
- **Allocation**: 15% moonshot / 65% risk-managed / 20% scalp

### Position Sizing Formula
```
position_size = (account_risk * account_balance) / (entry_price - stop_loss)
```

Where:
- `account_risk` = Maximum % of account to risk per trade (default: 1-2%)
- `account_balance` = Total account value
- `entry_price` = Planned entry price
- `stop_loss` = Stop-loss price

### Entry Criteria (High Conviction)
1. Volume spike > 3x average
2. Price above key MA (20/50/200)
3. RSI not overbought (< 70)
4. Whale accumulation detected
5. Positive sentiment from multiple sources

### Exit Criteria
- Take profit at 1.5x, 2x, 3x (scale out)
- Stop loss at -5% to -10% depending on volatility
- Trailing stop after 50% gain
- Time-based exit if no momentum after 24h

## Risk Parameters

| Risk Level | Position Size | Stop Loss | Take Profit |
|------------|--------------|-----------|-------------|
| Conservative | 1% | -5% | +15% |
| Moderate | 2% | -7% | +25% |
| Aggressive | 5% | -10% | +50% |

## Memecoin-Specific Rules

1. Never more than 10% portfolio in memecoins
2. Require liquidity > $50k
3. Check for honeypot/rug indicators
4. Verify contract renounced
5. Fast exit if volume dies (< 1h)
