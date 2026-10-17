//+------------------------------------------------------------------+
//| KANAL_Strateji.mq5                                               |
//| JARVIS - KANAL stratejisi v2 (KANAL3BAND + RSI + CCI MA)         |
//|                                                                  |
//| ALIŞ : 1) Mum TÜM alt bantların (en dış: merkez - 4.2xATR)       |
//|           DIŞINDA KAPANIR (fitil yetmez)                         |
//|        2) RSI 30'un altında kapanmıştır                          |
//|        3) Fiyat GERİ DÖNER: son mum iki dış bandın arasında kapanır|
//|        4) RSI 30'u YUKARI keser (bant dışı kapanış önce/aynı mum)|
//|        5) CCI mor çizgiyi (CCI MA) YUKARI keser                  |
//|        Kesişimler en fazla 10 mum önce + şu an hâlâ onaylı.      |
//| SATIŞ: tersi - TÜM üst bantların dışında kapanış, RSI 70 üstü,   |
//|        RSI 70'i AŞAĞI keser, CCI mor çizgiyi AŞAĞI keser.        |
//|                                                                  |
//| SL : ALIŞ  -> RSI 30'u yukarı kesmeden önceki EN DÜŞÜK fiyat     |
//|      SATIŞ -> RSI 70'i aşağı kesmeden önceki EN YÜKSEK fiyat     |
//| TP : bandın MERKEZ çizgisi (ilk hedef)                           |
//|                                                                  |
//| Zaman dilimleri: M3 / M5 / M15 / H1 (girişlerden seçilir).       |
//| Piyasa Gözlemi'ndeki TÜM pariteleri tarar.                       |
//| VARSAYILAN: sadece UYARI. Otomatik emir için InpAutoTrade=true.  |
//| Hesaplar KANAL3BAND / KANAL-CCI / KANAL-RSI ile aynı formüllerdir|
//| Merkez çizgi oluşmakta olan mumu içermez (sinyal titremez).      |
//+------------------------------------------------------------------+
#property copyright "JARVIS"
#property version   "3.21"
#property description "KANAL v2: tüm bantların dışında kapanış + RSI 30/70 kesişimi + CCI MA kesişimi. M3/M5/M15/H1."

#include <Trade\Trade.mqh>

enum ENUM_K_TP
  {
   KTP_CENTER = 0,      // Merkez çizgi (varsayılan)
   KTP_BAND   = 1       // En yakın karşı bant
  };

//--- Giriş parametreleri
input group "Zaman dilimleri (birden fazla seçilebilir)"
input bool            InpUseM3         = false;     // 3 dakika
input bool            InpUseM5         = true;      // 5 dakika
input bool            InpUseM15        = true;      // 15 dakika
input bool            InpUseH1         = false;     // 1 saat

input group "KANAL3BAND (merkez + ATR bantları)"
input int             InpHalfLength    = 60;        // Centered ATR Half Period
input int             InpAtrPeriod     = 100;       // Average True Range Period
input double          InpAtrMult1      = 4.2;       // ATR Multiplier 1
input double          InpAtrMult2      = 3.5;       // ATR Multiplier 2
input double          InpAtrMult3      = 2.8;       // ATR Multiplier 3
input double          InpMinBreakAtr   = 0.0;       // Kesin kapanış payı: en dış bandın en az (ATR x) dışında
input int             InpSetupLookback = 10;        // Bant dışı kapanış en fazla kaç mum önce olabilir

input group "RSI"
input int             InpRsiPeriod     = 14;        // RSI periyodu
input double          InpRsiOb         = 70.0;      // Üst seviye
input double          InpRsiOs         = 30.0;      // Alt seviye

input group "CCI (mor çizgi = CCI MA)"
input int             InpCciPeriod     = 34;        // CCI periyodu (typical price)
input int             InpCciMaPeriod   = 21;        // CCI MA periyodu (mor çizgi, SMA)
input int             InpCrossMaxAge   = 10;        // RSI/CCI kesişimi en fazla kaç mum önce (şu an hâlâ onaylı olmalı)

input group "Tarama"
input bool            InpScanMarketWatch = true;    // Piyasa Gözlemi'ndeki TÜM pariteleri tara
input int             InpTimerSec        = 5;       // Tarama aralığı (sn)
input int             InpMaxSymbols      = 60;      // En fazla parite

input group "Bildirim"
input bool            InpAlert         = true;      // Alert penceresi
input bool            InpPush          = false;     // Telefon bildirimi (MT5 mobil)
input bool            InpEmail         = false;     // E-posta

input group "Emir (varsayılan: SADECE UYARI)"
input bool            InpAutoTrade     = false;     // Otomatik emir aç (DİKKAT)
input int             InpMinConf       = 80;        // Otomatik emir için minimum güven (%)
input double          InpLots          = 0.10;      // Lot
input double          InpSlPadAtr      = 0.0;       // SL payı (ATR x) - 0 = tam dip/tepe
input ENUM_K_TP       InpTpMode        = KTP_CENTER;// Take profit noktası
input double          InpBeAtPct       = 30.0;      // SL'yi girişe çek: TP yolunun % kaçında (0 = kapalı)
input double          InpPartialAtPct  = 50.0;      // Yarı kâr al: TP yolunun % kaçında (0 = kapalı)
input double          InpPartialPct    = 50.0;      // Kapatılacak oran (%)
input ulong           InpMagic         = 330033;    // Magic number

//--- Sonuç yapısı
struct KResult
  {
   string   symbol;
   datetime barTime;
   double   rsi;
   double   cci;
   double   cciMa;
   double   center;
   double   atr;
   int      sellStage;
   int      buyStage;
   bool     sellFire;
   bool     buyFire;
   double   sellSl;
   double   sellTp;
   double   buySl;
   double   buyTp;
   int      sellConf;
   int      buyConf;
   double   sellPeak;
   double   buyPeak;
  };

//--- Genel değişkenler
CTrade   g_trade;
string   g_fireKey[];
datetime g_fireBar[];
int      g_firedTotal = 0;

//+------------------------------------------------------------------+
//| Yapı taşları                                                     |
//+------------------------------------------------------------------+
//+------------------------------------------------------------------+
//| Kısa zaman dilimi adı (emir yorumu için: "KANAL BUY M15")        |
//+------------------------------------------------------------------+
string TfShort(const ENUM_TIMEFRAMES tf)
  {
   string s = EnumToString(tf);          // PERIOD_M15
   StringReplace(s, "PERIOD_", "");      // M15
   return s;
  }

double OuterMult()
  {
   return MathMax(InpAtrMult1, MathMax(InpAtrMult2, InpAtrMult3));
  }

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

double AtrAt(const MqlRates &r[], const int i, const int P)
  {
   if(i < P + 10) return EMPTY_VALUE;
   double sum = 0.0;
   for(int j = 0; j < P; j++)
     {
      int q = i - 10 - j;
      sum += MathMax(r[q].high, r[q - 1].close) - MathMin(r[q].low, r[q - 1].close);
     }
   return sum / P;
  }

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

bool RsiBeyond(const bool sell, const double v)
  {
   if(v == EMPTY_VALUE) return false;
   return sell ? (v > InpRsiOb) : (v < InpRsiOs);
  }

//+------------------------------------------------------------------+
//| Bir yön için koşullar (bar tt'de)                                |
//+------------------------------------------------------------------+
void EvalSide(const bool sell, const int tt, const MqlRates &r[],
              const double &cy[], const double &atr[],
              const double &rsi[], const double &cci[], const double &ma[],
              bool &brk, bool &ext, bool &ret, bool &rsiOk, bool &cciOk,
              double &extreme, double &depth, double &peak)
  {
   const int    W = InpSetupLookback;
   const int    C = MathMin(InpCrossMaxAge, InpSetupLookback);
   const double M = OuterMult();
   brk = false;
   ext = false;
   ret = false;
   rsiOk = false;
   cciOk = false;
   depth = 0.0;
   peak = EMPTY_VALUE;

   int from = MathMax(1, tt - W + 1);
   int firstBrk = -1;
   int lastBrk  = -1;
   for(int b = from; b <= tt; b++)
     {
      if(cy[b] == EMPTY_VALUE || atr[b] == EMPTY_VALUE || atr[b] <= 0.0) continue;
      double outer = sell ? cy[b] + M * atr[b] : cy[b] - M * atr[b];
      double d = sell ? r[b].close - outer : outer - r[b].close;
      if(d > InpMinBreakAtr * atr[b])
        {
         brk = true;
         if(firstBrk < 0) firstBrk = b;
         lastBrk = b;
         if(d / atr[b] > depth) depth = d / atr[b];
        }
     }

   for(int b = MathMax(1, from - 1); b <= tt; b++)
     {
      if(rsi[b] == EMPTY_VALUE) continue;
      if(RsiBeyond(sell, rsi[b])) ext = true;
      if(peak == EMPTY_VALUE) peak = rsi[b];
      else peak = sell ? MathMax(peak, rsi[b]) : MathMin(peak, rsi[b]);
     }

   int x = -1;
   int f2 = MathMax(MathMax(1, from), tt - C + 1);
   for(int b = f2; b <= tt; b++)
     {
      if(rsi[b - 1] == EMPTY_VALUE || rsi[b] == EMPTY_VALUE) continue;
      if(sell && rsi[b - 1] > InpRsiOb && rsi[b] <= InpRsiOb) x = b;
      if(!sell && rsi[b - 1] < InpRsiOs && rsi[b] >= InpRsiOs) x = b;
     }
   // RSI kesişimi bant dışı kapanıştan sonra VE şu an hâlâ onaylı
   bool rNowOk = (rsi[tt] != EMPTY_VALUE) && (sell ? rsi[tt] <= InpRsiOb : rsi[tt] >= InpRsiOs);
   rsiOk = (x >= 0 && firstBrk >= 0 && firstBrk <= x && rNowOk);

   bool cciX = false;
   for(int b = f2; b <= tt; b++)
     {
      if(sell && SeriesCrossDown(cci, ma, b)) cciX = true;
      if(!sell && SeriesCrossUp(cci, ma, b))  cciX = true;
     }
   bool cNowOk = (cci[tt] != EMPTY_VALUE && ma[tt] != EMPTY_VALUE) && (sell ? cci[tt] < ma[tt] : cci[tt] > ma[tt]);
   cciOk = (cciX && cNowOk);

   // GERİ DÖNÜŞ: son kapanan mum iki dış bandın ARASINDA, bant dışı kapanış ondan önce
   if(cy[tt] != EMPTY_VALUE && atr[tt] != EMPTY_VALUE && firstBrk >= 0 && firstBrk < tt)
      ret = (r[tt].close < cy[tt] + M * atr[tt] && r[tt].close > cy[tt] - M * atr[tt]);

   // SL tabanı: RSI aşırı bölgedeyken (ve bant dışı kapanış mumundan) kesişim mumuna kadar uç fiyat
   int start = from;
   int end   = tt;
   if(x >= 0)
     {
      int s0 = x - 1;
      while(s0 - 1 >= 1 && x - s0 < 200 && RsiBeyond(sell, rsi[s0 - 1])) s0--;
      start = s0;
      if(firstBrk >= 0 && firstBrk <= x && firstBrk < start) start = firstBrk;
      end = x;
     }
   extreme = sell ? -DBL_MAX : DBL_MAX;
   for(int b = start; b <= end; b++)
     {
      if(sell && r[b].high > extreme) extreme = r[b].high;
      if(!sell && r[b].low < extreme) extreme = r[b].low;
     }
  }

int StageOf(const bool brk, const bool ext, const bool ret, const bool rsiOk, const bool cciOk)
  {
   if(!brk) return 0;
   if(!ext) return 1;
   return 2 + (ret ? 1 : 0) + (rsiOk ? 1 : 0) + (cciOk ? 1 : 0);
  }

//+------------------------------------------------------------------+
//| SL / TP                                                          |
//+------------------------------------------------------------------+
void Levels(const bool sell, const double entry, const double extreme, const double center, const double atr, double &sl, double &tp)
  {
   double pad = InpSlPadAtr * atr;
   double mm[3];
   mm[0] = InpAtrMult1;
   mm[1] = InpAtrMult2;
   mm[2] = InpAtrMult3;
   if(!sell)
     {
      sl = extreme - pad;
      if(sl >= entry) sl = entry - 1.5 * atr;
      tp = EMPTY_VALUE;
      if(InpTpMode == KTP_BAND)
        {
         for(int k = 0; k < 3; k++)
           {
            double v = center + mm[k] * atr;
            if(v > entry && (tp == EMPTY_VALUE || v < tp)) tp = v;
           }
         if(tp == EMPTY_VALUE) tp = entry + 2.0 * (entry - sl);
        }
      else
        {
         tp = center;
         if(tp <= entry) tp = entry + 1.5 * (entry - sl);
        }
     }
   else
     {
      sl = extreme + pad;
      if(sl <= entry) sl = entry + 1.5 * atr;
      tp = EMPTY_VALUE;
      if(InpTpMode == KTP_BAND)
        {
         for(int k = 0; k < 3; k++)
           {
            double v = center - mm[k] * atr;
            if(v < entry && (tp == EMPTY_VALUE || v > tp)) tp = v;
           }
         if(tp == EMPTY_VALUE) tp = entry - 2.0 * (sl - entry);
        }
      else
        {
         tp = center;
         if(tp >= entry) tp = entry - 1.5 * (sl - entry);
        }
     }
  }

//+------------------------------------------------------------------+
//| Güven: 60 + derinlik + RSI aşırılığı + CCI farkı + R:R           |
//+------------------------------------------------------------------+
int Confidence(const bool sell, const double depth, const double peak, const double cci, const double ma,
               const double entry, const double sl, const double tp)
  {
   double dp = MathMax(0.0, MathMin(10.0, depth * 20.0));
   double rp = 0.0;
   if(peak != EMPTY_VALUE) rp = sell ? peak - InpRsiOb : InpRsiOs - peak;
   rp = MathMax(0.0, MathMin(15.0, rp));
   double cp = 0.0;
   if(cci != EMPTY_VALUE && ma != EMPTY_VALUE) cp = MathMin(5.0, MathAbs(cci - ma) / 20.0);
   double rr = 0.0;
   if(MathAbs(entry - sl) > 0.0) rr = MathAbs(tp - entry) / MathAbs(entry - sl);
   double rrp = 0.0;
   if(rr >= 2.0) rrp = 10.0;
   else if(rr >= 1.5) rrp = 7.0;
   else if(rr >= 1.0) rrp = 4.0;
   return (int)MathMin(99.0, MathFloor(60.0 + dp + rp + cp + rrp + 0.5));
  }

//+------------------------------------------------------------------+
//| Bir parite / zaman dilimi için stratejiyi çalıştır               |
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
      pr[i] = (r[i].high + r[i].low + 2.0 * r[i].close) / 4.0;
      cl[i] = r[i].close;
     }
   double rsi[], cci[], ma[];
   RsiSeries(cl, n, InpRsiPeriod, rsi);
   CciSeries(r, n, InpCciPeriod, cci);
   SmaSeries(cci, n, InpCciMaPeriod, ma);

   const int t = n - 2;   // son KAPANMIŞ mum
   double cy[], atr[];
   ArrayResize(cy, n);
   ArrayResize(atr, n);
   for(int i = 0; i < n; i++)
     {
      cy[i]  = EMPTY_VALUE;
      atr[i] = EMPTY_VALUE;
     }
   for(int i = MathMax(1, t - InpSetupLookback - 4); i <= t; i++)
     {
      cy[i]  = CenterAt(pr, i, n - 1, InpHalfLength);   // oluşmakta olan mum hariç
      atr[i] = AtrAt(r, i, InpAtrPeriod);
     }
   if(cy[t] == EMPTY_VALUE || atr[t] == EMPTY_VALUE) return false;

   bool sBrk, sExt, sRet, sRsi, sCci, bBrk, bExt, bRet, bRsi, bCci, pBrk, pExt, pRet, pRsi, pCci;
   double sEx, sDep, sPk, bEx, bDep, bPk, tEx, tDep, tPk;
   EvalSide(true,  t, r, cy, atr, rsi, cci, ma, sBrk, sExt, sRet, sRsi, sCci, sEx, sDep, sPk);
   EvalSide(false, t, r, cy, atr, rsi, cci, ma, bBrk, bExt, bRet, bRsi, bCci, bEx, bDep, bPk);
   EvalSide(true,  t - 1, r, cy, atr, rsi, cci, ma, pBrk, pExt, pRet, pRsi, pCci, tEx, tDep, tPk);
   bool sellPrevArmed = (pBrk && pExt && pRet && pRsi && pCci);
   EvalSide(false, t - 1, r, cy, atr, rsi, cci, ma, pBrk, pExt, pRet, pRsi, pCci, tEx, tDep, tPk);
   bool buyPrevArmed = (pBrk && pExt && pRet && pRsi && pCci);

   bool sellArmed = (sBrk && sExt && sRet && sRsi && sCci);
   bool buyArmed  = (bBrk && bExt && bRet && bRsi && bCci);

   res.symbol    = sym;
   res.barTime   = r[t].time;
   res.rsi       = rsi[t];
   res.cci       = cci[t];
   res.cciMa     = ma[t];
   res.center    = cy[t];
   res.atr       = atr[t];
   res.sellStage = StageOf(sBrk, sExt, sRet, sRsi, sCci);
   res.buyStage  = StageOf(bBrk, bExt, bRet, bRsi, bCci);
   res.sellFire  = (sellArmed && !sellPrevArmed);
   res.buyFire   = (buyArmed && !buyPrevArmed);
   res.sellPeak  = sPk;
   res.buyPeak   = bPk;

   double bid = SymbolInfoDouble(sym, SYMBOL_BID);
   double ask = SymbolInfoDouble(sym, SYMBOL_ASK);
   if(bid <= 0.0) bid = r[n - 1].close;
   if(ask <= 0.0) ask = r[n - 1].close;

   double sl, tp;
   Levels(true, bid, sEx, cy[t], atr[t], sl, tp);
   res.sellSl   = sl;
   res.sellTp   = tp;
   res.sellConf = Confidence(true, sDep, sPk, cci[t], ma[t], bid, sl, tp);
   Levels(false, ask, bEx, cy[t], atr[t], sl, tp);
   res.buySl    = sl;
   res.buyTp    = tp;
   res.buyConf  = Confidence(false, bDep, bPk, cci[t], ma[t], ask, sl, tp);
   return true;
  }

//+------------------------------------------------------------------+
//| Yardımcılar                                                      |
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

void OnSignal(const string sym, const ENUM_TIMEFRAMES tf, const bool sell, const KResult &res)
  {
   int    digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   double sl   = sell ? res.sellSl : res.buySl;
   double tp   = sell ? res.sellTp : res.buyTp;
   int    conf = sell ? res.sellConf : res.buyConf;
   double pk   = sell ? res.sellPeak : res.buyPeak;
   string side = sell ? "SELL" : "BUY";
   string msg = StringFormat("KANAL SİNYAL: %s %s %s | güven %%%d | RSI %s %.1f -> %.1f | CCI %.0f / MA %.0f | SL %s TP(merkez) %s",
                             sym, EnumToString(tf), side, conf, (sell ? "tepe" : "dip"), pk, res.rsi, res.cci, res.cciMa,
                             DoubleToString(sl, digits), DoubleToString(tp, digits));
   Print(msg);
   if(InpAlert) Alert(msg);
   if(InpPush)  SendNotification(msg);
   if(InpEmail) SendMail("KANAL SİNYAL " + sym, msg);
   g_firedTotal++;

   if(InpAutoTrade && conf < InpMinConf)
      Print("KANAL: ", sym, " güven %", conf, " < %", InpMinConf, " - otomatik emir açılmadı (yalnızca uyarı).");
   if(InpAutoTrade && conf >= InpMinConf)
     {
      if(HasPosition(sym))
         Print("KANAL: ", sym, " için açık pozisyon var, yeni emir açılmadı.");
      else
         OpenTrade(sym, sell, sl, tp, "KANAL " + side + " " + TfShort(tf));
     }
  }

//+------------------------------------------------------------------+
//| Bu pozisyonda daha önce kısmi kapanış yapıldı mı? (geçmişte OUT) |
//+------------------------------------------------------------------+
bool PartialDone(const ulong posId)
  {
   if(!HistorySelectByPosition(posId)) return false;
   for(int i = HistoryDealsTotal() - 1; i >= 0; i--)
     {
      ulong d = HistoryDealGetTicket(i);
      if(d == 0) continue;
      long entry = HistoryDealGetInteger(d, DEAL_ENTRY);
      if(entry == DEAL_ENTRY_OUT || entry == DEAL_ENTRY_OUT_BY) return true;
     }
   return false;
  }

//+------------------------------------------------------------------+
//| Kâr yönetimi: %InpBeAtPct'te SL girişe, %InpPartialAtPct'te yarı  |
//| kâr al (TP yolunun yüzdesi)                                      |
//+------------------------------------------------------------------+
void ManageBreakeven()
  {
   if(InpBeAtPct <= 0.0 && InpPartialAtPct <= 0.0) return;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if((ulong)PositionGetInteger(POSITION_MAGIC) != InpMagic) continue;
      double open = PositionGetDouble(POSITION_PRICE_OPEN);
      double cur  = PositionGetDouble(POSITION_PRICE_CURRENT);
      double sl   = PositionGetDouble(POSITION_SL);
      double tp   = PositionGetDouble(POSITION_TP);
      double vol  = PositionGetDouble(POSITION_VOLUME);
      long   pid  = PositionGetInteger(POSITION_IDENTIFIER);
      string sym  = PositionGetString(POSITION_SYMBOL);
      bool   buy  = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY);
      if(tp <= 0.0) continue;
      double dist = buy ? (tp - open) : (open - tp);
      if(dist <= 0.0) continue;
      double prog = (buy ? (cur - open) : (open - cur)) / dist * 100.0;
      int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);

      // 1) SL girişe
      bool atBe = (sl > 0.0) && (buy ? (sl >= open) : (sl <= open));
      if(InpBeAtPct > 0.0 && prog >= InpBeAtPct && !atBe)
        {
         if(g_trade.PositionModify(ticket, NormalizeDouble(open, digits), tp))
            Print("KANAL: ", sym, " SL girişe çekildi (TP yolunun %", DoubleToString(prog, 0), ")");
         else
            Print("KANAL: ", sym, " SL girişe çekilemedi: ", g_trade.ResultRetcodeDescription());
        }

      // 2) Yarı kâr al
      if(InpPartialAtPct > 0.0 && prog >= InpPartialAtPct && !PartialDone((ulong)pid))
        {
         double step = SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP);
         double vmin = SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN);
         if(step <= 0.0) step = 0.01;
         double part = MathFloor(vol * InpPartialPct / 100.0 / step + 1e-9) * step;
         if(part < vmin || vol - part < vmin - 1e-9)
            continue;   // lot bölünemeyecek kadar küçük
         if(g_trade.PositionClosePartial(ticket, NormalizeDouble(part, 2)))
            Print("KANAL: ", sym, " yarı kâr alındı: ", DoubleToString(part, 2), " lot kapatıldı (TP yolunun %", DoubleToString(prog, 0), ")");
         else
            Print("KANAL: ", sym, " kısmi kapanış başarısız: ", g_trade.ResultRetcodeDescription());
        }
     }
  }

//+------------------------------------------------------------------+
int OnInit()
  {
   if(InpHalfLength < 1 || InpAtrPeriod < 1 || InpSetupLookback < 2 || InpCrossMaxAge < 1)
      return INIT_PARAMETERS_INCORRECT;
   if(!InpUseM3 && !InpUseM5 && !InpUseM15 && !InpUseH1)
     {
      Alert("KANAL: En az bir zaman dilimi seçin (M3 / M5 / M15 / H1).");
      return INIT_PARAMETERS_INCORRECT;
     }
   g_trade.SetExpertMagicNumber(InpMagic);
   EventSetTimer(MathMax(1, InpTimerSec));
   Comment("KANAL Strateji v2 başlatıldı...\nMod: ", (InpAutoTrade ? "OTOMATİK EMİR" : "SADECE UYARI"));
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
//| Zamanlayıcı: seçili zaman dilimlerinde tüm pariteleri tara       |
//+------------------------------------------------------------------+
void OnTimer()
  {
   ManageBreakeven();

   ENUM_TIMEFRAMES tfs[4];
   int ntf = 0;
   if(InpUseM3)  { tfs[ntf] = PERIOD_M3;  ntf++; }
   if(InpUseM5)  { tfs[ntf] = PERIOD_M5;  ntf++; }
   if(InpUseM15) { tfs[ntf] = PERIOD_M15; ntf++; }
   if(InpUseH1)  { tfs[ntf] = PERIOD_H1;  ntf++; }

   int total = InpScanMarketWatch ? SymbolsTotal(true) : 1;
   int limit = MathMin(total, InpMaxSymbols);
   int scanned = 0;
   string watchList = "";

   for(int s = 0; s < limit; s++)
     {
      string sym = InpScanMarketWatch ? SymbolName(s, true) : _Symbol;
      for(int k = 0; k < ntf; k++)
        {
         KResult res;
         if(!Analyze(sym, tfs[k], res)) continue;
         scanned++;
         string tfs_ = IntegerToString((int)tfs[k]);
         if(res.sellFire && !AlreadyFired(sym + "|S|" + tfs_, res.barTime)) OnSignal(sym, tfs[k], true, res);
         if(res.buyFire  && !AlreadyFired(sym + "|B|" + tfs_, res.barTime)) OnSignal(sym, tfs[k], false, res);
         if(res.sellStage >= 2) watchList += sym + " " + EnumToString(tfs[k]) + " SATIŞ " + IntegerToString(res.sellStage) + "/5\n";
         if(res.buyStage >= 2)  watchList += sym + " " + EnumToString(tfs[k]) + " ALIŞ "  + IntegerToString(res.buyStage)  + "/5\n";
        }
     }

   Comment("KANAL Strateji v2 | taranan: ", scanned, " | sinyal: ", g_firedTotal, " | ",
           (InpAutoTrade ? "OTOMATİK EMİR (güven >= %" + IntegerToString(InpMinConf) + ")" : "SADECE UYARI"),
           "\n", (watchList == "" ? "Yaklaşan kurulum yok" : "Yaklaşan kurulumlar (bant dışı + RSI aşırı bölge):\n" + watchList));
  }
//+------------------------------------------------------------------+
