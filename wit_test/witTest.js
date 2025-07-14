import readline from 'readline';
import fetch from 'node-fetch';
import 'dotenv/config';

// .env dosyasından API anahtarlarını yükle
const WIT_TOKEN = process.env.WIT_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// API anahtarlarının kontrolü
if (!WIT_TOKEN || !GEMINI_API_KEY) {
    console.error('❌ .env dosyasında WIT_TOKEN veya GEMINI_API_KEY eksik!');
    process.exit(1);
}

// Oturum bilgilerini tutan obje
const session = {
    hastane: null,
    bolum: null,
    datetime: null
};

/**
 * Wit.ai API'sine istek gönderir ve yanıtı döndürür.
 * @param {string} text Kullanıcının mesajı.
 * @returns {Promise<object>} Wit.ai'den gelen JSON yanıtı.
 */
async function askWit(text) {
    const witApiVersion = '20250710'; 

    const url = `https://api.wit.ai/message?v=${witApiVersion}&q=${encodeURIComponent(text)}`;
    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${WIT_TOKEN}` }
    });
    if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Wit.ai Hatası: ${res.status} - ${res.statusText} - Detay: ${errorText}`);
    }
    return res.json();
}

/**
 * Gemini API'sine istek gönderir ve yanıtı döndürür.
 * Hata durumlarını (kota, anahtar vb.) daha spesifik olarak ele alır.
 * @param {string} text Kullanıcının mesajı.
 * @param {string} [context=''] Gemini'ye gönderilecek ek bağlam bilgisi.
 * @returns {Promise<string>} Gemini'den gelen metin yanıtı veya hata mesajı.
 */
async function askGemini(text, context = '') {
    try {
        const url = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`; 
        
        const finalPrompt = context ? `${context}\n${text}` : text; 

        const body = {
            contents: [{
                parts: [{ text: finalPrompt }]
            }]
        };

        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        //console.log(res);

        const data = await res.json();
        
        if (data.error) {
            console.error("Gemini API Hata Detayı:", data.error);
            if (data.error.code === 429) {
                return "🤖 Üzgünüm, şu an çok fazla talep alıyorum. Lütfen biraz sonra tekrar deneyin (Kota Aşıldı).";
            } else if (data.error.code === 400 && data.error.message.includes("API key not valid")) {
                return "🤖 API anahtarımda bir sorun var. Lütfen geliştiriciye bildirin (Geçersiz API Anahtarı).";
            } else if (data.error.message) {
                return `🤖 Gemini ile iletişimde bir sorun oluştu: ${data.error.message}`;
            }
        }

        return data.candidates?.[0]?.content?.parts?.[0]?.text || 
               "🤖 Anlayamadım, lütfen başka şekilde ifade edin.";
    } catch (err) {
        console.error("Gemini API'sine erişim hatası:", err);
        return "🤖 Üzgünüm, şu anda Gemini ile bağlantı kuramıyorum. Lütfen internet bağlantınızı kontrol edin veya daha sonra tekrar deneyin.";
    }
}

/**
 * Kullanıcının mesajına göre botun yanıtını oluşturur.
 * @param {object} witData Wit.ai'den gelen yanıt verisi.
 * @param {string} userMessage Kullanıcının orijinal mesajı.
 * @returns {Promise<string>} Botun yanıtı.
 */
async function generateResponse(witData, userMessage) {
    const text = userMessage.toLowerCase();
    const intent = witData.intents?.[0]?.name;
    const confidence = witData.intents?.[0]?.confidence || 0;
    const entities = witData.entities;

    // Oturum bilgilerini Wit.ai'den gelen varlıklarla güncelle
    // Dünkü kodunuzdaki daha kapsamlı entity yakalama mantığı buraya entegre edildi.
    session.hastane = session.hastane 
        || entities["hastane:hastane"]?.[0]?.value 
        || entities["hastane"]?.[0]?.value;

    session.bolum = session.bolum 
        || entities["bolum:bolum"]?.[0]?.value 
        || entities["bolum"]?.[0]?.value;

    session.datetime = session.datetime 
        || entities["wit$datetime:datetime"]?.[0]?.value
        || entities["wit$datetime"]?.[0]?.value 
        || entities["wit/datetime:datetime"]?.[0]?.value 
        || entities["wit/datetime:datetime"]?.[0]?.values?.[0]?.value 
        || entities["wit/datetime"]?.[0]?.value 
        || entities["wit/datetime"]?.[0]?.values?.[0]?.value;

    // İptal komutu kontrolü
    if (text.includes('iptal') || text.includes('cancel')) {
        Object.keys(session).forEach(key => session[key] = null); // Oturumu sıfırla
        return "Randevu işlemi iptal edildi.";
    }

    // Randevu akışına girmek için "randevu" kelimesi aranıyor (Bu kısım isteğe bağlı, eğer otomatik algılansın isterseniz `false` yapabilirsiniz)
    const requiresRandevuKeyword = true; 
    const hasRandevuKeyword = text.includes('randevu');

    // Randevu alma akışı
    // Koşullar:
    // 1. Randevu kelimesi geçmesi (eğer şart koşuluyorsa) VE niyet 'randevu_al' ise ve güven yüksekse
    // VEYA
    // 2. Oturumda zaten randevu ile ilgili bilgiler varsa (hastane, bölüm, tarih) - bu kısım akışı devam ettirir.
    if ( (requiresRandevuKeyword && hasRandevuKeyword && intent === 'randevu_al' && confidence > 0.7) || 
         (!requiresRandevuKeyword && intent === 'randevu_al' && confidence > 0.7) || 
         session.hastane || session.bolum || session.datetime ) {
        
        // Randevu akışında eksik bilgi kontrolü
        if (!session.hastane) return "Hangi hastane için randevu almak istiyorsunuz?";
        if (!session.bolum) return "Hangi bölüm için randevu almak istiyorsunuz?";
        if (!session.datetime) return "Hangi tarih ve saatte randevu almak istiyorsunuz?"; // Dünkü metinle uyumlu hale getirildi

        const confirmation = `✅ Onay: ${session.hastane} hastanesi, ${session.bolum} bölümü için ${session.datetime} tarihine randevu talebiniz alındı. Onaylıyor musunuz? (evet/hayır)`;
        
        // Kullanıcı onayını bekle
        if (!text.includes('evet')) return confirmation;
        
        // Onaylandığında oturumu temizle
        Object.keys(session).forEach(key => session[key] = null);
        return "Randevunuz başarıyla oluşturuldu!"; // Dünkü metinle uyumlu hale getirildi
    }

    // Eğer randevu akışına girilmediyse, Gemini'yi devreye sokun.
    let geminiContextForPrompt = `Kullanıcının mesajı: "${userMessage}".`;
    if (intent && intent !== 'randevu_al' && confidence > 0.5) {
        geminiContextForPrompt += ` Wit.ai bunu "${intent}" niyeti olarak algıladı.`;
    } else {
        geminiContextForPrompt += ` Wit.ai belirli bir niyet belirleyemedi veya randevu akışına girilmedi.`;
    }
    geminiContextForPrompt += ` Lütfen doğal ve sohbetvari bir şekilde yanıt verin.`;

    return await askGemini(userMessage, geminiContextForPrompt);
}

// KOMUT SATIRI ARAYÜZÜ
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

console.log("🤖 Medikal Asistan başladı. Çıkmak için 'exit' yazın.");

// Sohbet döngüsü
async function chatLoop() {
    rl.question("Siz: ", async (userInput) => {
        if (userInput.toLowerCase() === 'exit') {
            console.log("Bot: Görüşmek üzere!");
            return rl.close();
        }

        try {
            const witData = await askWit(userInput);
            // Wit.ai yanıtını konsola yazdırma satırı tekrar kapatıldı.
            // console.debug("Wit.ai Yanıtı:", JSON.stringify(witData, null, 2)); 
            
            const botResponse = await generateResponse(witData, userInput);
            console.log("Bot:", botResponse);
        } catch (err) {
            console.error("Hata:", err.message);
            console.log("Bot: Üzgünüm, bir sorun oluştu. Lütfen tekrar deneyin.");
        }

        chatLoop(); // Sohbeti devam ettir
    });
}

chatLoop(); // Sohbet döngüsünü başlat
export { askWit, askGemini, generateResponse };