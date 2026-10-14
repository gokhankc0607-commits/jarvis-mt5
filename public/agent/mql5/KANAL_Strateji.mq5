//+------------------------------------------------------------------+
//| KANAL_Strateji.mq5                                               |
//| JARVIS - KANAL3BAND geri dönüş + RSI + CCI (MA) stratejisi       |
//|                                                                  |
//| SATIŞ : Fiyat ÜST bandı kırar ve kapanış band İÇİNE döner,       |
//|         RSI 70 altında, CCI mor çizgiyi (CCI MA) AŞAĞI keser.    |
//| ALIŞ  : Fiyat ALT bandı kırar ve kapanış band İÇİNE döner,       |
//|         RSI 30'u YUKARI keser, CCI mor çizgiyi YUKARI keser.     |
//|                                                                  |
//| Piyasa Gözlemi'nde (Market Watch) AÇIK olan TÜM pariteleri tarar.|
//| VARSAYILAN: sadece UYARI verir. Emir açması için                 |
//| InpAutoTrade = true yapılmalıdır (JARVIS onay kuralı için kapalı |
//| bırakın: emri JARVIS sesli "Evet" onayından sonra gönderir).     |
//|                                                                  |
//| Hesaplar KANAL3BAND, KANAL-CCI ve KANAL-RSI göstergeleriyle aynı |
//| formüllerdir; göstergelerin grafikte açık olması gerekmez.       |
//| NOT: Centered YSR merkez çizgisi yeniden boyanır. Strateji,      |
//| oluşmakta olan barı merkez hesabına katmaz (sadece kapanmış barlar|
//| ile) - sinyal bar boyunca sabit kalır. Yine de                   |
//| bu yüzden Strategy Tester sonuçları canlıyı birebir yansıtmaz.   |
//+------------------------------------------------------------------+
#property copyright "JARVIS"
#property version   "1.00"
#property description "KANAL3BAND geri dönüş + RSI + CCI MA kesişimi. Piyasa Gözlemi taraması."

#include <Trade\Trade.mqh>

//--- Enum tanımları
enum ENUM_K_SELL_RSI
  {
   KSR_BELOW      = 0,   // RSI 70 altında
   KSR_CROSS_DOWN = 1    // RSI 70'i aşağı kesmiş
  };

enum ENUM_K_BUY_RSI
  {
   KBR_CROSS_UP = 0,     // RSI 30'u yukarı kesmiş
   KBR_ABOVE    = 1      // RSI 30 üstünde
  };

enum ENUM_K_BAND
  {
   KB_1 = 1,             // Band 1 (en dış)
   KB_2 = 2,             // Band 2
   KB_3 = 3              // Band 3 (en iç - en hassas)
  };

//--- Giriş parametreleri
input group "KANAL3BAND (merkez + ATR bantları)"
input int             InpHalfLength    = 60;        // Centered ATR Half Period
input int             InpAtrPeriod     = 100;       // Average True Range Period
input double          InpAtrMult1      = 4.2;       // ATR Multiplier 1 (en dış)
input double          InpAtrMult2      = 3.5;       // ATR Multiplier 2
input double          InpAtrMult3      = 2.8;       // ATR Multiplier 3 (en iç)
input ENUM_K_BAND     InpBand          = KB_3;      // Kırılacak/dönülecek band
input int             InpBreakLookback = 5;         // Band kırılımı için bakılacak bar sayısı
input bool            InpBreakByClose  = false;     // Kırılım kapanışla mı (false = fitil yeter)

input group "RSI"
input int             InpRsiPeriod     = 14;        // RSI periyodu
input double          InpRsiOb         = 70.0;      // Üst seviye
input double          InpRsiOs         = 30.0;      // Alt seviye
input ENUM_K_SELL_RSI InpSellRsi       = KSR_BELOW;      // SATIŞ için RSI koşulu
input ENUM_K_BUY_RSI  InpBuyRsi        = KBR_CROSS_UP;   // ALIŞ için RSI koşulu

input group "CCI (mor çizgi = CCI MA)"
input int             InpCciPeriod     = 34;        // CCI periyodu (typical price)
input int             InpCciMaPeriod   = 21;        // CCI MA periyodu (mor çizgi, SMA)
input int             InpCrossLookback = 3;         // RSI/CCI kesişimi için bakılacak bar sayısı

input group "Tarama"
input bool            InpScanMarketWatch = true;           // Piyasa Gözlemi'ndeki TÜM pariteleri tara
input ENUM_TIMEFRAMES InpTf              = PERIOD_CURRENT; // Zaman dilimi
input int             InpTimerSec        = 5;              // Tarama aralığı (sn)
input int             InpMaxSymbols      = 60;             // En fazla parite

input group "Bildirim"
input bool            InpAlert         = true;      // Alert penceresi
input bool            InpPush          = false;     // Telefon bildirimi (MT5 mobil)
input bool            InpEmail         = false;     // E-posta

input group "Emir (varsayılan: SADECE UYARI)"
input bool            InpAutoTrade     = false;     // Otomatik emir aç (DİKKAT)
input double          InpLots          = 0.10;      // Lot
input double          InpSlBufferAtr   = 0.5;       // SL payı (ATR x) - kırılım ucunun ötesi
input ulong           InpMagic         = 330033;    // Magic number

//--- Sonuç yapısı
struct KResult
  {
   string   symbol;
   double   price;
   double   rsi;
   double   cci;
   double   cciMa;
   double   center;
   double   atr;
   datetime barTime;
   int      sellStage;
   int      buyStage;
   bool     sellFire;
   bool     buyFire;
   double   sellSl;
   double   sellTp;
   double   buySl;
   double   buyTp;
  };

//--- Genel değişkenler
CTrade   g_trade;
string   g_fireKey[];
datetime g_fireBar[];
int      g_firedTotal = 0;

//+------------------------------------------------------------------+
//| Seçili band çarpanı                                              |
//+------------------------------------------------------------------+
double BandMult()
  {
   if(InpBand == KB_1) return InpAtrMult1;
   if(InpBand == KB_2) return InpAtrMult2;
   return InpAtrMult3;
  }

//+------------------------------------------------------------------+
//| Centered YSR: üçgen ağırlıklı merkezi ortalama (son bara kadar)  |
//+------------------------------------------------------------------+
double CenterAt(const double &pr[], const int i, const int n, const int H)
  {
   if(i - H < 0) return EMPTY_VALUE;
   double sum = (H + 1) * pr[i];
   double sw  = H + 1;
   int    k   = H;
   for(int j = 1; j <= H; j++)
     {
      sum += k * pr[i - j];
      sw  += k;
      if(i + j <= n - 1)
        {
         sum += k * pr[i + j];
         sw  += k;
        }
      k--;
     }
   return sum / sw;
  }

//+------------------------------------------------------------------+
//| KANAL3BAND ATR'si: TR'lerin basit ortalaması, 10 bar geriden     |
//+------------------------------------------------------------------+
double AtrAt(const MqlRates &r[], const int i, const int P)
  {
   if(i < P + 10) return EMPTY_VALUE;
   double sum = 0.0;
   for(int j = 0; j < P; j++)
     {
      int q = i - 10 - j;
      double hi = MathMax(r[q].high, r[q - 1].close);
      double lo = MathMin(r[q].low,  r[q - 1].close);
      sum += hi - lo;
     }
   return sum / P;
  }

//+------------------------------------------------------------------+
//| Wilder RSI                                                       |
//+------------------------------------------------------------------+
double RsiFromAvg(const double up, const double down)
  {
   if(down == 0.0) return 100.0;
   if(up == 0.0)   return 0.0;
   return 100.0 - 100.0 / (1.0 + up / down);
  }

void RsiSeries(const double &cl[], const int n, const int period, double &out[])
  {
   ArrayResize(out, n);
   for(int i = 0; i < n; i++) out[i] = EMPTY_VALUE;
   if(period < 1 || n <= period) return;

   double sumU = 0.0, sumD = 0.0;
   for(int i = 1; i <= period; i++)
     {
      double ch = cl[i] - cl[i - 1];
      sumU += MathMax(ch, 0.0);
      sumD += MathMax(-ch, 0.0);
     }
   double avgU = sumU / period;
   double avgD = sumD / period;
   out[period] = RsiFromAvg(avgU, avgD);

   for(int i = period + 1; i < n; i++)
     {
      double ch = cl[i] - cl[i - 1];
      avgU = (avgU * (period - 1) + MathMax(ch, 0.0))  / period;
      avgD = (avgD * (period - 1) + MathMax(-ch, 0.0)) / period;
      out[i] = RsiFromAvg(avgU, avgD);
     }
  }

//+------------------------------------------------------------------+
//| CCI (typical price)                                              |
//+------------------------------------------------------------------+
void CciSeries(const MqlRates &r[], const int n, const int period, double &out[])
  {
   double tp[];
   ArrayResize(tp, n);
   ArrayResize(out, n);
   for(int i = 0; i < n; i++)
     {
      tp[i]  = (r[i].high + r[i].low + r[i].close) / 3.0;
      out[i] = EMPTY_VALUE;
     }
   for(int i = period - 1; i < n; i++)
     {
      double sum = 0.0;
      for(int k = 0; k < period; k++) sum += tp[i - k];
      double sma = sum / period;
      double dev = 0.0;
      for(int k = 0; k < period; k++) dev += MathAbs(tp[i - k] - sma);
      dev /= period;
      out[i] = (dev != 0.0) ? (tp[i] - sma) / (0.015 * dev) : 0.0;
     }
  }

//+------------------------------------------------------------------+
//| SMA (EMPTY_VALUE'ları atlayarak ilk geçerli değerden başlar)     |
//+------------------------------------------------------------------+
void SmaSeries(const double &src[], const int n, const int period, double &out[])
  {
   ArrayResize(out, n);
   for(int i = 0; i < n; i++) out[i] = EMPTY_VALUE;
   int s = -1;
   for(int i = 0; i < n; i++)
     {
      if(src[i] != EMPTY_VALUE) { s = i; break; }
     }
   if(s < 0) return;
   for(int i = s + period - 1; i < n; i++)
     {
      double sum = 0.0;
      for(int k = 0; k < period; k++) sum += src[i - k];
      out[i] = sum / period;
     }
  }

//+------------------------------------------------------------------+
//| Kesişim yardımcıları                                             |
//+------------------------------------------------------------------+
bool SeriesCrossUp(const double &a[], const double &b[], const int idx)
  {
   if(idx < 1) return false;
   if(a[idx] == EMPTY_VALUE || b[idx] == EMPTY_VALUE || a[idx - 1] == EMPTY_VALUE || b[idx - 1] == EMPTY_VALUE) return false;
   return (a[idx - 1] <= b[idx - 1] && a[idx] > b[idx]);
  }

bool SeriesCrossDown(const double &a[], const double &b[], const int idx)
  {
   if(idx < 1) return false;
   if(a[idx] == EMPTY_VALUE || b[idx] == EMPTY_VALUE || a[idx - 1] == EMPTY_VALUE || b[idx - 1] == EMPTY_VALUE) return false;
   return (a[idx - 1] >= b[idx - 1] && a[idx] < b[idx]);
  }

bool LevelCrossUp(const double &a[], const int idx, const double lvl)
  {
   if(idx < 1) return false;
   if(a[idx] == EMPTY_VALUE || a[idx - 1] == EMPTY_VALUE) return false;
   return (a[idx - 1] < lvl && a[idx] >= lvl);
  }

bool LevelCrossDown(const double &a[], const int idx, const double lvl)
  {
   if(idx < 1) return false;
   if(a[idx] == EMPTY_VALUE || a[idx - 1] == EMPTY_VALUE) return false;
   return (a[idx - 1] > lvl && a[idx] <= lvl);
  }

//+------------------------------------------------------------------+
//| Bir yön için dört koşulu bar t'de değerlendir                    |
//+------------------------------------------------------------------+
void EvalSide(const bool sell, const int t, const MqlRates &r[],
              const double &cy[], const double &atr[],
              const double &rsi[], const double &cci[], const double &ma[],
              bool &brk, bool &ret, bool &rsiOk, bool &cciOk, double &extreme)
  {
   brk = false;
   ret = false;
   rsiOk = false;
   cciOk = false;
   extreme = sell ? -DBL_MAX : DBL_MAX;
   const double mult = BandMult();

   int from = t - InpBreakLookback + 1;
   if(from < 1) from = 1;
   for(int b = from; b <= t; b++)
     {
      if(cy[b] == EMPTY_VALUE || atr[b] == EMPTY_VALUE) continue;
      if(sell)
        {
         double lvl = cy[b] + mult * atr[b];
         double px  = InpBreakByClose ? r[b].close : r[b].high;
         if(px > lvl) brk = true;
         if(r[b].high > extreme) extreme = r[b].high;
        }
      else
        {
         double lvl = cy[b] - mult * atr[b];
         double px  = InpBreakByClose ? r[b].close : r[b].low;
         if(px < lvl) brk = true;
         if(r[b].low < extreme) extreme = r[b].low;
        }
     }

   if(brk && cy[t] != EMPTY_VALUE && atr[t] != EMPTY_VALUE)
     {
      if(sell) ret = (r[t].close < cy[t] + mult * atr[t]);
      else     ret = (r[t].close > cy[t] - mult * atr[t]);
     }

   int f2 = t - InpCrossLookback + 1;
   if(f2 < 1) f2 = 1;
   if(sell)
     {
      if(InpSellRsi == KSR_BELOW)
         rsiOk = (rsi[t] != EMPTY_VALUE && rsi[t] < InpRsiOb);
      else
         for(int b = f2; b <= t; b++) if(LevelCrossDown(rsi, b, InpRsiOb)) rsiOk = true;
      for(int b = f2; b <= t; b++) if(SeriesCrossDown(cci, ma, b)) cciOk = true;
     }
   else
     {
      if(InpBuyRsi == KBR_ABOVE)
         rsiOk = (rsi[t] != EMPTY_VALUE && rsi[t] > InpRsiOs);
      else
         for(int b = f2; b <= t; b++) if(LevelCrossUp(rsi, b, InpRsiOs)) rsiOk = true;
      for(int b = f2; b <= t; b++) if(SeriesCrossUp(cci, ma, b)) cciOk = true;
     }
  }

int StageOf(const bool brk, const bool ret, const bool rsiOk, const bool cciOk)
  {
   if(!brk) return 0;
   if(!ret) return 1;
   return 2 + (cciOk ? 1 : 0) + (rsiOk ? 1 : 0);
  }

//+------------------------------------------------------------------+
//| Bir parite/zaman dilimi için stratejiyi çalıştır                 |
//+------------------------------------------------------------------+
bool Analyze(const string sym, const ENUM_TIMEFRAMES tf, KResult &res)
  {
   const int need = MathMax(500, InpAtrPeriod + InpHalfLength + 250);
   MqlRates r[];
   ArraySetAsSeries(r, false);
   int n = CopyRates(sym, tf, 0, need, r);
   if(n < InpAtrPeriod + InpHalfLength + 30) return false;

   double pr[], cl[];
   ArrayResize(pr, n);
   ArrayResize(cl, n);
   for(int i = 0; i < n; i++)
     {
      pr[i] = (r[i].high + r[i].low + 2.0 * r[i].close) / 4.0;   // PB_WEIGHTED
      cl[i] = r[i].close;
     }

   double rsi[], cci[], ma[];
   RsiSeries(cl, n, InpRsiPeriod, rsi);
   CciSeries(r, n, InpCciPeriod, cci);
   SmaSeries(cci, n, InpCciMaPeriod, ma);

   const int t = n - 2;   // son KAPANMIŞ bar (n-1 oluşmakta olan bar)
   const int span = MathMax(InpBreakLookback, InpCrossLookback) + 4;
   double cy[], atr[];
   ArrayResize(cy, n);
   ArrayResize(atr, n);
   for(int i = 0; i < n; i++)
     {
      cy[i]  = EMPTY_VALUE;
      atr[i] = EMPTY_VALUE;
     }
   for(int i = MathMax(1, t - span); i <= t; i++)
     {
      cy[i]  = CenterAt(pr, i, n - 1, InpHalfLength);   // oluşmakta olan bar (n-1) hariç -> bar içinde titremez
      atr[i] = AtrAt(r, i, InpAtrPeriod);
     }
   if(cy[t] == EMPTY_VALUE || atr[t] == EMPTY_VALUE) return false;

   bool sBrk, sRet, sRsi, sCci, bBrk, bRet, bRsi, bCci;
   bool pBrk, pRet, pRsi, pCci;
   double sEx, bEx, tmpEx;

   EvalSide(true,  t, r, cy, atr, rsi, cci, ma, sBrk, sRet, sRsi, sCci, sEx);
   EvalSide(false, t, r, cy, atr, rsi, cci, ma, bBrk, bRet, bRsi, bCci, bEx);

   // Kenar tetikleme: önceki bar (t-1) için tüm koşullar zaten sağlanıyor muydu?
   EvalSide(true,  t - 1, r, cy, atr, rsi, cci, ma, pBrk, pRet, pRsi, pCci, tmpEx);
   bool sellPrevArmed = (pBrk && pRet && pRsi && pCci);
   EvalSide(false, t - 1, r, cy, atr, rsi, cci, ma, pBrk, pRet, pRsi, pCci, tmpEx);
   bool buyPrevArmed = (pBrk && pRet && pRsi && pCci);

   bool sellArmed = (sBrk && sRet && sRsi && sCci);
   bool buyArmed  = (bBrk && bRet && bRsi && bCci);

   res.symbol    = sym;
   res.barTime   = r[t].time;
   res.rsi       = rsi[t];
   res.cci       = cci[t];
   res.cciMa     = ma[t];
   res.center    = cy[t];
   res.atr       = atr[t];
   res.sellStage = StageOf(sBrk, sRet, sRsi, sCci);
   res.buyStage  = StageOf(bBrk, bRet, bRsi, bCci);
   res.sellFire  = (sellArmed && !sellPrevArmed);
   res.buyFire   = (buyArmed && !buyPrevArmed);

   double bid = SymbolInfoDouble(sym, SYMBOL_BID);
   double ask = SymbolInfoDouble(sym, SYMBOL_ASK);
   if(bid <= 0.0) bid = r[n - 1].close;
   if(ask <= 0.0) ask = r[n - 1].close;
   res.price = bid;

   // SATIŞ seviyeleri: SL = kırılım ucunun üstü, TP = merkez çizgi
   double sl = sEx + InpSlBufferAtr * atr[t];
   if(sl <= bid) sl = bid + 1.5 * atr[t];
   double tp = cy[t];
   if(tp >= bid) tp = bid - 1.5 * (sl - bid);
   res.sellSl = sl;
   res.sellTp = tp;

   // ALIŞ seviyeleri: SL = kırılım ucunun altı, TP = merkez çizgi
   sl = bEx - InpSlBufferAtr * atr[t];
   if(sl >= ask) sl = ask - 1.5 * atr[t];
   tp = cy[t];
   if(tp <= ask) tp = ask + 1.5 * (ask - sl);
   res.buySl = sl;
   res.buyTp = tp;
   return true;
  }

//+------------------------------------------------------------------+
//| Aynı bar için tekrar sinyal vermeyi engelle                      |
//+------------------------------------------------------------------+
bool AlreadyFired(const string key, const datetime bar)
  {
   int total = ArraySize(g_fireKey);
   for(int i = 0; i < total; i++)
     {
      if(g_fireKey[i] == key)
        {
         if(g_fireBar[i] == bar) return true;
         g_fireBar[i] = bar;
         return false;
        }
     }
   ArrayResize(g_fireKey, total + 1);
   ArrayResize(g_fireBar, total + 1);
   g_fireKey[total] = key;
   g_fireBar[total] = bar;
   return false;
  }

double NormalizeLots(const string sym, const double lots)
  {
   double step = SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP);
   double vmin = SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN);
   double vmax = SymbolInfoDouble(sym, SYMBOL_VOLUME_MAX);
   if(step <= 0.0) step = 0.01;
   double v = MathFloor(lots / step + 0.5) * step;
   if(v < vmin) v = vmin;
   if(v > vmax) v = vmax;
   return NormalizeDouble(v, 2);
  }

bool HasPosition(const string sym)
  {
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) == sym && (ulong)PositionGetInteger(POSITION_MAGIC) == InpMagic)
         return true;
     }
   return false;
  }

bool OpenTrade(const string sym, const bool sell, double sl, double tp, const string comment)
  {
   int    digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   double lots   = NormalizeLots(sym, InpLots);
   double price  = sell ? SymbolInfoDouble(sym, SYMBOL_BID) : SymbolInfoDouble(sym, SYMBOL_ASK);
   sl = NormalizeDouble(sl, digits);
   tp = NormalizeDouble(tp, digits);
   bool ok = sell ? g_trade.Sell(lots, sym, price, sl, tp, comment)
                  : g_trade.Buy(lots, sym, price, sl, tp, comment);
   if(!ok)
      Print("KANAL emir hatası ", sym, ": ", g_trade.ResultRetcode(), " ", g_trade.ResultRetcodeDescription());
   return ok;
  }

//+------------------------------------------------------------------+
//| Sinyal bildirimi (ve isteğe bağlı emir)                          |
//+------------------------------------------------------------------+
void OnSignal(const string sym, const ENUM_TIMEFRAMES tf, const bool sell, const KResult &res)
  {
   int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   double sl = sell ? res.sellSl : res.buySl;
   double tp = sell ? res.sellTp : res.buyTp;
   string side = sell ? "SELL" : "BUY";
   string msg = StringFormat("KANAL SİNYAL: %s %s %s | RSI %.1f | CCI %.0f (MA %.0f) | SL %s TP %s",
                             sym, EnumToString(tf), side, res.rsi, res.cci, res.cciMa,
                             DoubleToString(sl, digits), DoubleToString(tp, digits));
   Print(msg);
   if(InpAlert) Alert(msg);
   if(InpPush)  SendNotification(msg);
   if(InpEmail) SendMail("KANAL SİNYAL " + sym, msg);
   g_firedTotal++;

   if(InpAutoTrade)
     {
      if(HasPosition(sym))
         Print("KANAL: ", sym, " için açık pozisyon var, yeni emir açılmadı.");
      else
         OpenTrade(sym, sell, sl, tp, "KANAL " + side);
     }
  }

//+------------------------------------------------------------------+
int OnInit()
  {
   if(InpHalfLength < 1 || InpAtrPeriod < 1 || InpBreakLookback < 1 || InpCrossLookback < 1)
      return INIT_PARAMETERS_INCORRECT;
   g_trade.SetExpertMagicNumber(InpMagic);
   EventSetTimer(MathMax(1, InpTimerSec));
   Comment("KANAL Strateji başlatıldı...\nMod: ", (InpAutoTrade ? "OTOMATİK EMİR" : "SADECE UYARI"));
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   Comment("");
  }

void OnTick()
  {
  }

//+------------------------------------------------------------------+
//| Zamanlayıcı: Piyasa Gözlemi'ndeki tüm pariteleri tara            |
//+------------------------------------------------------------------+
void OnTimer()
  {
   ENUM_TIMEFRAMES tf = (InpTf == PERIOD_CURRENT) ? (ENUM_TIMEFRAMES)Period() : InpTf;
   int total = InpScanMarketWatch ? SymbolsTotal(true) : 1;
   int limit = MathMin(total, InpMaxSymbols);
   int scanned = 0;
   string watchList = "";

   for(int s = 0; s < limit; s++)
     {
      string sym = InpScanMarketWatch ? SymbolName(s, true) : _Symbol;
      KResult res;
      if(!Analyze(sym, tf, res)) continue;
      scanned++;

      if(res.sellFire && !AlreadyFired(sym + "|S|" + IntegerToString((int)tf), res.barTime))
         OnSignal(sym, tf, true, res);
      if(res.buyFire && !AlreadyFired(sym + "|B|" + IntegerToString((int)tf), res.barTime))
         OnSignal(sym, tf, false, res);

      // Yaklaşan kurulumları ekranda göster (band kırıldı + geri döndü)
      if(res.sellStage >= 2) watchList += sym + " SATIŞ " + IntegerToString(res.sellStage) + "/4\n";
      if(res.buyStage >= 2)  watchList += sym + " ALIŞ "  + IntegerToString(res.buyStage)  + "/4\n";
     }

   Comment("KANAL Strateji | ", EnumToString(tf), " | taranan: ", scanned, "/", limit,
           " | sinyal: ", g_firedTotal, " | ", (InpAutoTrade ? "OTOMATİK EMİR" : "SADECE UYARI"),
           "\n", (watchList == "" ? "Yaklaşan kurulum yok" : "Yaklaşan kurulumlar:\n" + watchList));
  }
//+------------------------------------------------------------------+
