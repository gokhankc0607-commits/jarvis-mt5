//+------------------------------------------------------------------+
//| KANAL_Strateji.mq5                                               |
//| JARVIS - KANAL3BAND geri dönüş + RSI + CCI (MA) stratejisi       |
//|                                                                  |
//| SATIŞ : Fiyat ÜST bandı kırar; İLK KURAL mum band İÇİNDE kapanır,|
//|         SONRA CCI mor çizgiyi (CCI MA) AŞAĞI keser, RSI 70 altı, |
//|         RSI ve CCI arka arkaya AYNI yönde (aşağı).               |
//| ALIŞ  : Fiyat ALT bandı kırar; İLK KURAL mum band İÇİNDE kapanır,|
//|         SONRA CCI mor çizgiyi YUKARI keser, RSI 30'u yukarı,     |
//|         RSI ve CCI arka arkaya AYNI yönde (yukarı).              |
//| SL    : önceki dip/tepe veya RSI dönüş barı -/+ ATR payı.        |
//| TP    : girişe EN YAKIN karşı band (ALIŞ üst / SATIŞ alt).       |
//| GÜVEN : 40 + 12xkırılan band + 10xsıra + 10xyön + aşırılık (<=97)|
//|                                                                  |
//| Piyasa Gözlemi'nde (Market Watch) AÇIK olan TÜM pariteleri tarar.|
//| VARSAYILAN: sadece UYARI verir. InpAutoTrade = true ise güven >= |
//| InpAutoMinConf, sıra OK ve yön OK olan sinyallerde emir açar;    |
//| hedefin InpBreakEvenPct'si kadar kârda SL girişe çekilir.        |
//| (JARVIS ajanı ile birlikte kullanıyorsanız burada kapalı bırakın;|
//| otomatik işlemi panelden ajan yürütür - çift emir açılmasın.)    |
//|                                                                  |
//| Hesaplar KANAL3BAND, KANAL-CCI ve KANAL-RSI göstergeleriyle aynı |
//| formüllerdir; göstergelerin grafikte açık olması gerekmez.       |
//| NOT: Centered YSR merkez çizgisi yeniden boyanır. Strateji,      |
//| oluşmakta olan barı merkez hesabına katmaz (sadece kapanmış barlar|
//| ile) - sinyal bar boyunca sabit kalır. Yine de                   |
//| bu yüzden Strategy Tester sonuçları canlıyı birebir yansıtmaz.   |
//+------------------------------------------------------------------+
#property copyright "JARVIS"
#property version   "1.10"
#property description "KANAL3BAND: band içine kapanış -> RSI + CCI onayı (sıra + yön). Otomatik emir, en yakın band TP, breakeven."

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

enum ENUM_K_SL_ANCHOR
  {
   KSA_SWING_RSI = 0,    // Önceki dip/tepe + RSI dönüş barı (daha korumalı olan)
   KSA_BREAK     = 1     // Yalnız kırılım ucu
  };

enum ENUM_K_TP_MODE
  {
   KTP_NEAREST_BAND = 0, // Girişe en yakın karşı band
   KTP_CENTER       = 1  // Merkez çizgi
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

input group "Sıra ve yön onayı"
input bool            InpStrictOrder   = true;      // Önce band içine kapanış, SONRA RSI/CCI onayı
input int             InpConfirmBars   = 1;         // RSI & CCI arka arkaya aynı yön (bar, 0 = kapalı)
input ENUM_K_SL_ANCHOR InpSlAnchor     = KSA_SWING_RSI;    // SL çapası
input ENUM_K_TP_MODE  InpTpMode        = KTP_NEAREST_BAND; // Take profit

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
input int             InpAutoMinConf   = 80;        // Otomatik emir için en düşük güven (%)
input int             InpMaxOpen       = 3;         // Bu EA'nın en fazla açık işlemi
input int             InpBreakEvenPct  = 30;        // Hedefin %'si kadar kârda SL -> giriş (0 = kapalı)
input double          InpLots          = 0.10;      // Lot
input double          InpSlBufferAtr   = 0.5;       // SL payı (ATR x) - çapanın ötesi
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
   bool     sellSeq;
   bool     buySeq;
   bool     sellAgree;
   bool     buyAgree;
   int      sellConf;
   int      buyConf;
   double   sellSl;
   double   sellTp;
   double   buySl;
   double   buyTp;
  };

//--- Bir yönün değerlendirme sonucu
struct KSide
  {
   bool     brk;        // band kırıldı
   bool     ret;        // mum band içinde kapandı (İLK KURAL)
   bool     rsiOk;      // RSI koşulu (strictOrder: dönüşten sonra)
   bool     cciOk;      // CCI MA kesişimi (strictOrder: dönüşten sonra)
   bool     seq;        // sıra: dönüş -> RSI & CCI onayı
   bool     agree;      // RSI ve CCI arka arkaya aynı yönde
   int      strength;   // kırılan band sayısı (1-3)
   double   extreme;    // kırılım penceresinin ucu
   double   anchor;     // SL çapası
   double   turnPrice;  // RSI dönüş barının tepesi/dibi
   double   rsiExt;
   double   cciExt;
   bool     hasTurn;
   bool     hasRsiExt;
   bool     hasCciExt;
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
//| RSI / CCI onayı: [lo, t] penceresinde                            |
//+------------------------------------------------------------------+
bool RsiEval(const bool sell, const int t, const int lo, const double &rsi[])
  {
   if(sell)
     {
      if(InpSellRsi == KSR_BELOW) return (rsi[t] != EMPTY_VALUE && rsi[t] < InpRsiOb);
      for(int b = lo; b <= t; b++) if(LevelCrossDown(rsi, b, InpRsiOb)) return true;
      return false;
     }
   if(InpBuyRsi == KBR_ABOVE) return (rsi[t] != EMPTY_VALUE && rsi[t] > InpRsiOs);
   for(int b = lo; b <= t; b++) if(LevelCrossUp(rsi, b, InpRsiOs)) return true;
   return false;
  }

bool CciEval(const bool sell, const int t, const int lo, const double &cci[], const double &ma[])
  {
   for(int b = lo; b <= t; b++)
      if(sell ? SeriesCrossDown(cci, ma, b) : SeriesCrossUp(cci, ma, b)) return true;
   return false;
  }

//+------------------------------------------------------------------+
//| Bir yön için koşulları bar t'de değerlendir                      |
//| (kanal_strategy.py / kanal.ts ile birebir aynı mantık)           |
//+------------------------------------------------------------------+
void EvalSide(const bool sell, const int t, const MqlRates &r[],
              const double &cy[], const double &atr[],
              const double &rsi[], const double &cci[], const double &ma[],
              KSide &o)
  {
   o.brk = false; o.ret = false; o.rsiOk = false; o.cciOk = false; o.seq = false; o.agree = false;
   o.strength = 0;
   o.extreme = sell ? -DBL_MAX : DBL_MAX;
   o.anchor = o.extreme; o.turnPrice = 0.0; o.rsiExt = 0.0; o.cciExt = 0.0;
   o.hasTurn = false; o.hasRsiExt = false; o.hasCciExt = false;

   const double mult = BandMult();
   double mults[3];
   mults[0] = InpAtrMult1; mults[1] = InpAtrMult2; mults[2] = InpAtrMult3;
   bool pierced[3];
   for(int k = 0; k < 3; k++) pierced[k] = false;
   int firstOut = -1;      // ilk kırılım barı
   int lastCloseOut = -1;  // kapanışı band DIŞINDA kalan son bar

   int from = t - InpBreakLookback + 1;
   if(from < 1) from = 1;
   for(int b = from; b <= t; b++)
     {
      if(cy[b] == EMPTY_VALUE || atr[b] == EMPTY_VALUE) continue;
      double px = sell ? (InpBreakByClose ? r[b].close : r[b].high) : (InpBreakByClose ? r[b].close : r[b].low);
      for(int k = 0; k < 3; k++)
        {
         double lv = sell ? cy[b] + mults[k] * atr[b] : cy[b] - mults[k] * atr[b];
         if(sell ? (px > lv) : (px < lv)) pierced[k] = true;
        }
      double lvl = sell ? cy[b] + mult * atr[b] : cy[b] - mult * atr[b];
      if(sell ? (px > lvl) : (px < lvl))
        {
         o.brk = true;
         if(firstOut < 0) firstOut = b;
        }
      if(sell ? (r[b].close > lvl) : (r[b].close < lvl)) lastCloseOut = b;
      if(sell) { if(r[b].high > o.extreme) o.extreme = r[b].high; }
      else     { if(r[b].low  < o.extreme) o.extreme = r[b].low;  }
     }
   for(int k = 0; k < 3; k++) if(pierced[k]) o.strength++;

   if(o.brk && cy[t] != EMPTY_VALUE && atr[t] != EMPTY_VALUE)
     {
      if(sell) o.ret = (r[t].close < cy[t] + mult * atr[t]);
      else     o.ret = (r[t].close > cy[t] - mult * atr[t]);
     }

   // Dönüş barı (İLK KURAL: band içinde mum kapanışı): dışarıda kapanan son bardan sonra içeride kapanan
   // ilk bar; hiç dışarıda kapanış yoksa (fitil kırılımı) kırılım barının kendisi.
   int reentry = -1;
   if(o.brk)
     {
      if(lastCloseOut < 0) reentry = firstOut;
      else
         for(int b = lastCloseOut + 1; b <= t; b++)
           {
            if(cy[b] == EMPTY_VALUE || atr[b] == EMPTY_VALUE) continue;
            double lv = sell ? cy[b] + mult * atr[b] : cy[b] - mult * atr[b];
            if(sell ? (r[b].close < lv) : (r[b].close > lv)) { reentry = b; break; }
           }
     }

   int f2 = t - InpCrossLookback + 1;
   if(f2 < 1) f2 = 1;
   int f2s = (reentry >= 0) ? MathMax(f2, reentry) : f2;   // sıkı pencere: dönüş barından itibaren
   bool rsiLoose  = RsiEval(sell, t, f2,  rsi);
   bool rsiStrict = RsiEval(sell, t, f2s, rsi);
   bool cciLoose  = CciEval(sell, t, f2,  cci, ma);
   bool cciStrict = CciEval(sell, t, f2s, cci, ma);
   o.seq   = (o.ret && rsiStrict && cciStrict);          // önce dönüş, sonra RSI & CCI onayı
   o.rsiOk = InpStrictOrder ? rsiStrict : rsiLoose;
   o.cciOk = InpStrictOrder ? cciStrict : cciLoose;

   // Yön onayı: RSI ve CCI son N kapanmış barda ARKA ARKAYA aynı yönde
   int nb = MathMax(1, InpConfirmBars);
   o.agree = true;
   for(int k = 0; k < nb; k++)
     {
      int i = t - k;
      if(i < 1 || rsi[i] == EMPTY_VALUE || rsi[i - 1] == EMPTY_VALUE || cci[i] == EMPTY_VALUE || cci[i - 1] == EMPTY_VALUE)
        { o.agree = false; break; }
      bool same = sell ? (rsi[i] < rsi[i - 1] && cci[i] < cci[i - 1]) : (rsi[i] > rsi[i - 1] && cci[i] > cci[i - 1]);
      if(!same) { o.agree = false; break; }
     }

   // RSI'ın dönüş yaptığı bar (penceredeki RSI ucu) + RSI/CCI uçları (SL çapası ve güven skoru)
   int f3 = t - InpBreakLookback - InpCrossLookback + 1;
   if(f3 < 1) f3 = 1;
   int turn = -1;
   for(int i = f3; i <= t; i++)
     {
      if(rsi[i] == EMPTY_VALUE) continue;
      if(turn < 0 || (sell ? (rsi[i] > o.rsiExt) : (rsi[i] < o.rsiExt))) { turn = i; o.rsiExt = rsi[i]; o.hasRsiExt = true; }
     }
   for(int i = f3; i <= t; i++)
     {
      if(cci[i] == EMPTY_VALUE) continue;
      if(!o.hasCciExt || (sell ? (cci[i] > o.cciExt) : (cci[i] < o.cciExt))) { o.cciExt = cci[i]; o.hasCciExt = true; }
     }
   if(turn >= 0) { o.hasTurn = true; o.turnPrice = sell ? r[turn].high : r[turn].low; }
   o.anchor = o.extreme;
   if(InpSlAnchor == KSA_SWING_RSI && o.hasTurn && o.extreme != -DBL_MAX && o.extreme != DBL_MAX)
      o.anchor = sell ? MathMax(o.extreme, o.turnPrice) : MathMin(o.extreme, o.turnPrice);
  }

bool ArmedOf(const KSide &s)
  {
   return (s.brk && s.ret && s.rsiOk && s.cciOk && (s.agree || InpConfirmBars <= 0));
  }

int StageOf(const KSide &s)
  {
   if(!s.brk) return 0;
   if(!s.ret) return 1;
   if(ArmedOf(s)) return 5;
   return 2 + (s.cciOk ? 1 : 0) + (s.rsiOk ? 1 : 0);
  }

//+------------------------------------------------------------------+
//| Güven skoru (panel/ajan ile aynı formül)                         |
//+------------------------------------------------------------------+
int Confidence(const bool sell, const KSide &s)
  {
   if(!s.brk) return 0;
   double c = 40.0 + 12.0 * s.strength + (s.seq ? 10.0 : 0.0) + (s.agree ? 10.0 : 0.0);
   if(sell)
     {
      if(s.hasRsiExt) c += MathMin(12.0, MathMax(0.0, s.rsiExt - InpRsiOb));
      if(s.hasCciExt) c += (s.cciExt >= 100.0 ? 8.0 : (s.cciExt >= 50.0 ? 4.0 : 0.0));
     }
   else
     {
      if(s.hasRsiExt) c += MathMin(12.0, MathMax(0.0, InpRsiOs - s.rsiExt));
      if(s.hasCciExt) c += (s.cciExt <= -100.0 ? 8.0 : (s.cciExt <= -50.0 ? 4.0 : 0.0));
     }
   return (int)MathMin(97.0, MathFloor(c + 0.5));
  }

//+------------------------------------------------------------------+
//| SL = çapa -/+ ATR payı · TP = en yakın karşı band (veya merkez)  |
//+------------------------------------------------------------------+
void Levels(const bool sell, const double entry, const double anchor, const double center, const double atrv,
            double &sl, double &tp)
  {
   double mults[3];
   mults[0] = InpAtrMult1; mults[1] = InpAtrMult2; mults[2] = InpAtrMult3;
   bool found = false;
   tp = 0.0;
   if(sell)
     {
      sl = anchor + InpSlBufferAtr * atrv;
      if(sl <= entry) sl = entry + 1.5 * atrv;
      if(InpTpMode == KTP_NEAREST_BAND)
         for(int k = 0; k < 3; k++)
           {
            double v = center - mults[k] * atrv;
            if(v < entry - 0.5 * atrv && (!found || v > tp)) { tp = v; found = true; }
           }
      if(!found) tp = center;
      if(tp >= entry) tp = entry - 1.5 * (sl - entry);
      return;
     }
   sl = anchor - InpSlBufferAtr * atrv;
   if(sl >= entry) sl = entry - 1.5 * atrv;
   if(InpTpMode == KTP_NEAREST_BAND)
      for(int k = 0; k < 3; k++)
        {
         double v = center + mults[k] * atrv;
         if(v > entry + 0.5 * atrv && (!found || v < tp)) { tp = v; found = true; }
        }
   if(!found) tp = center;
   if(tp <= entry) tp = entry + 1.5 * (entry - sl);
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

   KSide sS, bS, pS;
   EvalSide(true,  t, r, cy, atr, rsi, cci, ma, sS);
   EvalSide(false, t, r, cy, atr, rsi, cci, ma, bS);

   // Kenar tetikleme: önceki bar (t-1) için tüm koşullar zaten sağlanıyor muydu?
   EvalSide(true,  t - 1, r, cy, atr, rsi, cci, ma, pS);
   bool sellPrevArmed = ArmedOf(pS);
   EvalSide(false, t - 1, r, cy, atr, rsi, cci, ma, pS);
   bool buyPrevArmed = ArmedOf(pS);

   bool sellArmed = ArmedOf(sS);
   bool buyArmed  = ArmedOf(bS);

   res.symbol    = sym;
   res.barTime   = r[t].time;
   res.rsi       = rsi[t];
   res.cci       = cci[t];
   res.cciMa     = ma[t];
   res.center    = cy[t];
   res.atr       = atr[t];
   res.sellStage = StageOf(sS);
   res.buyStage  = StageOf(bS);
   res.sellFire  = (sellArmed && !sellPrevArmed);
   res.buyFire   = (buyArmed && !buyPrevArmed);
   res.sellSeq   = sS.seq;
   res.buySeq    = bS.seq;
   res.sellAgree = sS.agree;
   res.buyAgree  = bS.agree;
   res.sellConf  = Confidence(true,  sS);
   res.buyConf   = Confidence(false, bS);

   double bid = SymbolInfoDouble(sym, SYMBOL_BID);
   double ask = SymbolInfoDouble(sym, SYMBOL_ASK);
   if(bid <= 0.0) bid = r[n - 1].close;
   if(ask <= 0.0) ask = r[n - 1].close;
   res.price = bid;

   // SATIŞ: SL = tepe / RSI dönüş barı + ATR payı · TP = girişin altındaki en yakın alt band
   double sl = 0.0, tp = 0.0;
   Levels(true, bid, sS.anchor, cy[t], atr[t], sl, tp);
   res.sellSl = sl;
   res.sellTp = tp;

   // ALIŞ: SL = önceki dip / RSI dönüş barı - ATR payı · TP = girişin üstündeki en yakın üst band
   Levels(false, ask, bS.anchor, cy[t], atr[t], sl, tp);
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

int OpenCount()
  {
   int n = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if((ulong)PositionGetInteger(POSITION_MAGIC) == InpMagic) n++;
     }
   return n;
  }

//+------------------------------------------------------------------+
//| Breakeven: hedefin InpBreakEvenPct'si kadar kârda SL -> giriş    |
//+------------------------------------------------------------------+
void ManageBreakEven()
  {
   if(InpBreakEvenPct <= 0) return;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if((ulong)PositionGetInteger(POSITION_MAGIC) != InpMagic) continue;
      string sym  = PositionGetString(POSITION_SYMBOL);
      double open = PositionGetDouble(POSITION_PRICE_OPEN);
      double cur  = PositionGetDouble(POSITION_PRICE_CURRENT);
      double sl   = PositionGetDouble(POSITION_SL);
      double tp   = PositionGetDouble(POSITION_TP);
      if(tp <= 0.0) continue;
      bool isBuy  = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY);
      double dist = MathAbs(tp - open);
      if(dist <= 0.0) continue;
      double gain = isBuy ? (cur - open) : (open - cur);
      if(gain / dist < InpBreakEvenPct / 100.0) continue;
      bool already = (sl > 0.0) && (isBuy ? (sl >= open) : (sl <= open));
      if(already) continue;
      int    digits  = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
      double point   = SymbolInfoDouble(sym, SYMBOL_POINT);
      double minDist = (double)SymbolInfoInteger(sym, SYMBOL_TRADE_STOPS_LEVEL) * point;
      double ref     = isBuy ? SymbolInfoDouble(sym, SYMBOL_BID) : SymbolInfoDouble(sym, SYMBOL_ASK);
      if(isBuy ? (ref - open < minDist) : (open - ref < minDist)) continue;   // stops level; sonraki tikte tekrar
      double newSl = NormalizeDouble(open, digits);
      if(g_trade.PositionModify(ticket, newSl, tp))
         Print("KANAL breakeven: ", sym, " #", ticket, " kâr %", DoubleToString(100.0 * gain / dist, 0), " -> SL ", DoubleToString(newSl, digits));
     }
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
   bool seq   = sell ? res.sellSeq   : res.buySeq;
   bool agree = sell ? res.sellAgree : res.buyAgree;
   int  conf  = sell ? res.sellConf  : res.buyConf;
   string msg = StringFormat("KANAL SİNYAL: %s %s %s | güven %%%d | sıra %s | yön %s | RSI %.1f | CCI %.0f (MA %.0f) | SL %s TP %s",
                             sym, EnumToString(tf), side, conf, (seq ? "OK" : "-"), (agree ? "OK" : "-"),
                             res.rsi, res.cci, res.cciMa, DoubleToString(sl, digits), DoubleToString(tp, digits));
   Print(msg);
   if(InpAlert) Alert(msg);
   if(InpPush)  SendNotification(msg);
   if(InpEmail) SendMail("KANAL SİNYAL " + sym, msg);
   g_firedTotal++;

   if(InpAutoTrade)
     {
      if(conf < InpAutoMinConf)
         Print("KANAL: ", sym, " güven %", conf, " < %", InpAutoMinConf, " -> emir açılmadı.");
      else if(!seq)
         Print("KANAL: ", sym, " sıra kuralı yok (önce band içine kapanış, sonra RSI/CCI) -> emir açılmadı.");
      else if(!agree)
         Print("KANAL: ", sym, " RSI ve CCI yön onayı yok -> emir açılmadı.");
      else if(HasPosition(sym))
         Print("KANAL: ", sym, " için açık pozisyon var, yeni emir açılmadı.");
      else if(OpenCount() >= InpMaxOpen)
         Print("KANAL: açık işlem tavanı (", InpMaxOpen, ") dolu, ", sym, " emri açılmadı.");
      else
         OpenTrade(sym, sell, sl, tp, "KANAL AUTO " + side);
     }
  }

//+------------------------------------------------------------------+
int OnInit()
  {
   if(InpHalfLength < 1 || InpAtrPeriod < 1 || InpBreakLookback < 1 || InpCrossLookback < 1 ||
      InpConfirmBars < 0 || InpConfirmBars > 5 || InpAutoMinConf < 0 || InpAutoMinConf > 97 ||
      InpMaxOpen < 1 || InpBreakEvenPct < 0 || InpBreakEvenPct > 90)
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
   if(InpAutoTrade) ManageBreakEven();
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
   if(InpAutoTrade) ManageBreakEven();   // diğer paritelerdeki pozisyonlar için (OnTick yalnız grafik sembolünde)

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
      if(res.sellStage >= 2) watchList += sym + " SATIŞ " + IntegerToString(res.sellStage) + "/5 (%" + IntegerToString(res.sellConf) + ")\n";
      if(res.buyStage >= 2)  watchList += sym + " ALIŞ "  + IntegerToString(res.buyStage)  + "/5 (%" + IntegerToString(res.buyConf) + ")\n";
     }

   Comment("KANAL Strateji | ", EnumToString(tf), " | taranan: ", scanned, "/", limit,
           " | sinyal: ", g_firedTotal, " | ", (InpAutoTrade ? "OTOMATİK EMİR" : "SADECE UYARI"),
           "\n", (watchList == "" ? "Yaklaşan kurulum yok" : "Yaklaşan kurulumlar:\n" + watchList));
  }
//+------------------------------------------------------------------+
