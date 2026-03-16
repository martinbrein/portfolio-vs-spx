/**
 * Supported benchmark indices for portfolio comparison.
 * `symbol` is the Yahoo Finance ticker.
 * MERVAL is fetched in ARS and converted to USD using MEP rate.
 */
export const INDICES = {
  SPX:    { label: 'S&P 500',    symbol: '^GSPC' },
  DJI:    { label: 'Dow Jones',  symbol: '^DJI'  },
  NASDAQ: { label: 'Nasdaq',     symbol: '^IXIC' },
  MERVAL: { label: 'Merval USD', symbol: '^MERV' },
}
