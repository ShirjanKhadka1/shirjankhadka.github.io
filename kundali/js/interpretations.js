"use strict";
/* Interpretation texts for the kundali report.
 * Plain, warm English. No em dashes. No fear-based language.
 * Health is symbolic only, not medical advice.
 * Remedies are traditional beliefs, not prescriptions.
 * Astrology is presented as a cultural framework for reflection and
 * entertainment, not scientific certainty.
 */

const SIGNS = ['Aries','Taurus','Gemini','Cancer','Leo','Virgo','Libra','Scorpio','Sagittarius','Capricorn','Aquarius','Pisces'];
const NAKSHATRAS = ['Ashwini','Bharani','Krittika','Rohini','Mrigashira','Ardra','Punarvasu','Pushya','Ashlesha','Magha','Purva Phalguni','Uttara Phalguni','Hasta','Chitra','Swati','Vishakha','Anuradha','Jyeshtha','Mula','Purva Ashadha','Uttara Ashadha','Shravana','Dhanishta','Shatabhisha','Purva Bhadrapada','Uttara Bhadrapada','Revati'];
const PLANETS = ['Sun','Moon','Mars','Mercury','Jupiter','Venus','Saturn','Rahu','Ketu'];
// lowercase keys used across the engine
const PLANET_KEYS = ['sun','moon','mars','mercury','jupiter','venus','saturn','rahu','ketu'];

function signOf(long) { var x = long % 360; if (x < 0) x += 360; return Math.floor(x / 30) % 12; }
function degreeInSign(long) { var x = long % 360; if (x < 0) x += 360; return x % 30; }

/* ============ 12 Lagna portraits (~120-150 words each) ============ */
const LAGNA_PORTRAITS = [
/* Aries */ "Aries rising gives you a direct, pioneering temperament. Classical texts describe Mesha lagna natives as quick to act, fond of initiative, and comfortable leading from the front. You tend to meet life head on, and your energy rises when there is a challenge to take up. The flip side of this fire is impatience: you may start faster than you finish, and benefit from deliberately slowing down before big decisions. Mars, your chart lord, shapes how this plays out, so note its placement and strength. In relationships you value honesty over diplomacy. Professionally you do well where courage, speed, or competition matter. Your vitality is generally strong, and physical activity keeps both body and mind steady. The traditional counsel for this lagna is simple: aim the fire, do not just feel it.",
/* Taurus */ "Taurus rising gives you steadiness, patience, and a builder's temperament. Classical texts associate Vrishabha lagna with endurance, a love of comfort and beauty, and loyalty that runs deep. You move at your own pace, but once you commit, you finish. Venus, your chart lord, lends an eye for quality and a calm, pleasing manner. In money matters you are naturally conservative and good at accumulating over time. In relationships you offer constancy and expect the same. Your challenge is rigidity: when plans change suddenly you may resist longer than is useful. Physical comfort matters to you, so guard against overindulgence in food and rest. The traditional counsel for this lagna is to keep your persistence but practice flexibility, so that steadiness becomes strength rather than stubbornness.",
/* Gemini */ "Gemini rising gives you a quick, curious mind and a gift for words. Classical texts describe Mithuna lagna as adaptable, communicative, and youthful in outlook. You learn fast, connect ideas easily, and are at ease with many kinds of people. Mercury, your chart lord, makes intellect your natural instrument, so its placement and dignity matter greatly in your chart. Your challenge is restlessness: attention can scatter across too many interests, and depth sometimes loses to variety. In work you shine in communication, trade, writing, teaching, and anything involving information. In relationships you need mental companionship as much as affection. The traditional counsel for this lagna is to finish what fascinates you: choose a few threads and follow them deep, and your versatility becomes mastery.",
/* Cancer */ "Cancer rising gives you emotional depth, intuition, and a strong protective instinct. Classical texts associate Karka lagna with sensitivity, attachment to home and family, and a memory that holds everything. You feel situations before you analyze them, and your instincts about people are often right. The Moon, your chart lord, makes your inner state the weather of your life, so its phase and placement deserve attention. Your challenge is mood: you may withdraw when hurt instead of speaking plainly. In work you do well in caring professions, food, property, and roles needing empathy. In relationships you give deeply and need emotional security in return. The traditional counsel for this lagna is to let feelings inform decisions without ruling them, turning sensitivity into your finest instrument.",
/* Leo */ "Leo rising gives you warmth, dignity, and a natural authority that others notice. Classical texts describe Simha lagna as generous, proud, and drawn to visible roles. You carry yourself with confidence and prefer to lead rather than follow. The Sun, your chart lord, ties your vitality to recognition and purpose, so having a stage, however small, matters to you. Your challenge is pride: criticism can sting more than it should, and you may avoid admitting mistakes. In work you suit leadership, administration, creative fields, and public roles. In relationships you are loyal and protective, expecting respect in return. The traditional counsel for this lagna is that true leadership is service: the more generous your use of authority, the more naturally people follow.",
/* Virgo */ "Virgo rising gives you precision, discernment, and a genuinely helpful nature. Classical texts associate Kanya lagna with analytical skill, modesty, and attention to detail. You notice what others miss and take quiet satisfaction in improving things. Mercury, your chart lord, makes your mind your greatest asset, so its condition shapes much of your chart. Your challenge is over-analysis: worry can masquerade as thoroughness, and you may criticize yourself as sharply as you refine your work. In professions you excel in health, analysis, editing, craft, and service roles. In relationships you show love through practical care. The traditional counsel for this lagna is to accept good enough where perfection is not required, and to turn your critical eye kindly upon yourself.",
/* Libra */ "Libra rising gives you grace, fairness, and a talent for bringing people together. Classical texts describe Tula lagna as balanced, sociable, and drawn to harmony and beauty. You instinctively see both sides of a question, which makes you a natural mediator. Venus, your chart lord, gives charm and an eye for aesthetics. Your challenge is indecision: the desire to keep everyone happy can delay your own choices. In work you suit law, counseling, arts, diplomacy, and partnerships of all kinds. In relationships you are devoted and romantic, though you must guard against losing yourself in pleasing others. The traditional counsel for this lagna is that balance includes your own needs: learn to disappoint people occasionally, and your harmony becomes real rather than performed.",
/* Scorpio */ "Scorpio rising gives you intensity, insight, and remarkable resilience. Classical texts associate Vrishchika lagna with depth, secrecy, and the ability to regenerate after crisis. You see beneath surfaces, and people sense that little escapes you. Mars, your chart lord in the classical scheme, gives courage and a fighting spirit. Your challenge is control: you may hold grudges or test the loyalty of others instead of trusting openly. In work you suit research, investigation, healing, finance, and any field rewarding depth. In relationships you bond totally or not at least, and demand the same loyalty you give. The traditional counsel for this lagna is to use your transformative power on yourself first: what you master within, you need not control without.",
/* Sagittarius */ "Sagittarius rising gives you optimism, honesty, and a love of the bigger picture. Classical texts describe Dhanu lagna as philosophical, adventurous, and drawn to teaching and higher learning. You think in principles and dislike narrow thinking. Jupiter, your chart lord, blesses you with faith in life and often with good mentors. Your challenge is overextension: promising more than time allows, or preaching when listening would serve better. In work you suit teaching, law, publishing, travel, and advisory roles. In relationships you are warm and generous, needing a partner who shares your sense of adventure. The traditional counsel for this lagna is to ground your vision in detail: aim at the stars, but mind the steps on the ladder.",
/* Capricorn */ "Capricorn rising gives you discipline, patience, and a long view of life. Classical texts associate Makara lagna with perseverance, practicality, and slow but certain rise. You are comfortable with effort and distrust shortcuts. Saturn, your chart lord, makes time your ally: your best years often come after steady building. Your challenge is heaviness: you may carry burdens unnecessarily or postpone joy for some future milestone. In work you suit administration, engineering, business, and any field rewarding structure. In relationships you are loyal and serious, slow to open but deeply committed. The traditional counsel for this lagna is to schedule lightness deliberately: ambition sustains you, but rest and warmth complete you.",
/* Aquarius */ "Aquarius rising gives you originality, independence, and concern for the larger human picture. Classical texts describe Kumbha lagna as unconventional, thoughtful, and drawn to ideals and groups. You think ahead of your time and value friendship highly, sometimes more than convention. Saturn, your classical chart lord, gives endurance and a serious core beneath the progressive surface. Your challenge is detachment: you may intellectualize feelings or keep people at arm's length. In work you suit technology, reform, science, social causes, and networked roles. In relationships you need a partner who respects your freedom. The traditional counsel for this lagna is to let your ideals touch individual lives: humanity in the abstract matters less than kindness to the person in front of you.",
/* Pisces */ "Pisces rising gives you compassion, imagination, and a fluid, receptive nature. Classical texts associate Meena lagna with empathy, creativity, and spiritual inclination. You absorb the moods around you and often understand others without words. Jupiter, your chart lord, gives faith and a forgiving heart. Your challenge is boundaries: you may drift, over-give, or escape into fantasy when reality feels harsh. In work you suit arts, healing, music, charity, and spiritual or imaginative fields. In relationships you love selflessly but must choose partners who honor your softness. The traditional counsel for this lagna is to give your sensitivity a structure, through routine, craft, or practice, so that feeling deeply becomes creating deeply rather than merely drifting."
];

/* ============ Planet in house (9 x 12, ~40 words each) ============ */
const PLANET_HOUSE = {
sun: [
"Sun in the 1st gives a strong sense of self and natural authority. You carry yourself with dignity and prefer to lead. Vitality is good when you live with purpose, and others look to you in a crisis.",
"Sun in the 2nd ties identity to family, values, and earned wealth. Speech carries weight. You build resources steadily, take pride in providing, and your traditional values anchor financial decisions.",
"Sun in the 3rd gives courage, initiative, and skill with your hands and words. You are self made in spirit and do well through your own efforts. Siblings respect your directness, and short travels bring gains.",
"Sun in the 4th centers life on home, property, and inner peace. There can be distance or formality with the mother. Real estate and vehicles favor you, and you build a solid foundation quietly.",
"Sun in the 5th gives creativity, intelligence, and pride in children. You shine in speculative or advisory roles. Romance carries a dramatic flavor, and your creative intelligence wins admirers.",
"Sun in the 6th gives strength against rivals and skill in service or health fields. You handle competition well. Keep an eye on digestion and stress, since routine and discipline protect your vitality.",
"Sun in the 7th puts focus on partnership and public dealings. Marriage and alliances shape your path. Choose partners who respect your independence, and keep contracts clear to protect your reputation.",
"Sun in the 8th gives interest in hidden matters and resilience through change. Gains can come through others. Guard vitality, avoid unnecessary risk, and use your depth in research or healing fields.",
"Sun in the 9th gives fortune through dharma, mentors, and higher learning. You respect tradition and may travel far. Father or teachers influence you strongly, and principles guide your big decisions.",
"Sun in the 10th is a classic placement for career distinction and authority. Leadership roles suit you. Reputation grows through responsible public conduct, and integrity crowns your steady rise.",
"Sun in the 11th gives influential friends and gains through networks. Ambitions are large and often fulfilled. Elder siblings may be prominent, and long-held wishes materialize through good alliances.",
"Sun in the 12th gives a private, reflective nature with interest in foreign lands or spiritual life. Expenses need watching. Service behind the scenes suits you, and solitude restores your energy."
],
moon: [
"Moon in the 1st gives emotional sensitivity and an attractive, changeable personality. Moods shift, but empathy is strong. Public dealings favor you, and people remember your kindness.",
"Moon in the 2nd gives pleasant speech and fluctuating but recovering finances. Family bonds are close. You earn well through public or food related work, and savings grow with consistent habits.",
"Moon in the 3rd gives artistic hands, courage with a soft edge, and affectionate siblings. Short travels please you. The mind needs variety, and communication skills open many doors.",
"Moon in the 4th gives deep attachment to home and mother, and inner emotional richness. Property and vehicles come naturally. Peace of mind is your true wealth, so protect your domestic harmony.",
"Moon in the 5th gives a creative, romantic mind and affection for children. Intelligence is intuitive rather than linear. Speculation needs caution, but artistic pursuits bring genuine joy.",
"Moon in the 6th gives the ability to handle opponents and health routines with care. Service roles suit you. Keep stress and digestion in balance through regular habits and sufficient rest.",
"Moon in the 7th makes partnership central to emotional life. You need a caring, responsive partner. Public popularity is likely, and marriage brings emotional fulfillment when nurtured well.",
"Moon in the 8th gives emotional depth and interest in the occult or research. Moods can run deep. Guard against anxiety, build steady routines, and channel sensitivity into healing work.",
"Moon in the 9th gives devotion, fortune through mentors, and love of travel or philosophy. The mother or teachers guide you. Faith sustains you through uncertainty, and learning broadens your world.",
"Moon in the 10th gives public visibility and a career connected to people, care, or change. Reputation fluctuates but recovers. Adaptability is your asset, and public trust grows over time.",
"Moon in the 11th gives a wide circle of friends and gains through community. Hopes are usually fulfilled. Social work or networks reward you, and friendships bring both joy and opportunity.",
"Moon in the 12th gives a rich inner life, vivid dreams, and compassion for the suffering. Solitude restores you. Foreign lands may call, and quiet service brings deep satisfaction."
],
mars: [
"Mars in the 1st gives energy, courage, and a pioneering drive. You act fast and lead naturally. Channel the fire into sport or enterprise, not conflict, and your initiative will carry you far.",
"Mars in the 2nd gives forceful speech and drive to earn. Family matters may see friction. Wealth comes through effort and technical skill, so direct your intensity into productive work.",
"Mars in the 3rd is strong for courage, siblings, and initiative. You win through boldness. Writing, engineering, or adventure sports suit you, and your determination inspires others.",
"Mars in the 4th gives drive for property and vehicles, but possible tension at home. Direct the energy into building and renovation. Domestic peace improves when you stay physically active.",
"Mars in the 5th gives competitive spirit and technical creativity. Romance can be impulsive. Children need patient handling, and your sharp mind excels in strategy and games.",
"Mars in the 6th is excellent for defeating rivals, service, and health professions. You thrive on challenge. Discipline keeps the body strong, and hard work consistently defeats opposition.",
"Mars in the 7th brings passion and friction into partnerships. Choose partners carefully and practice patience. Business partnerships need clear written terms to avoid disputes.",
"Mars in the 8th gives research ability and resilience, with sudden turns in life. Handle joint finances carefully. Interest in the hidden is strong, and you recover quickly from shocks.",
"Mars in the 9th gives an active, principled nature with possible differences with mentors. Fortune favors the bold. Travel and higher study energize you, and conviction drives your actions.",
"Mars in the 10th gives ambition, leadership, and success through effort. Careers in engineering, defense, or management suit you. Your reputation is built on courage and results.",
"Mars in the 11th gives powerful friends and gains through enterprise. Ambitions run high and are pursued aggressively. Networks reward boldness, and friends admire your drive.",
"Mars in the 12th gives hidden energy and work behind the scenes. Foreign connections help. Rest and privacy restore you, so avoid bottled up anger and find healthy outlets."
],
mercury: [
"Mercury in the 1st gives sharp intellect, wit, and skill with words. You learn fast and adapt quickly. Communication is your natural strength, and curiosity keeps you young.",
"Mercury in the 2nd gives clever speech and skill in trade and finance. You earn through knowledge and negotiation. Family discussions favor you, and your counsel on money is valued.",
"Mercury in the 3rd gives writing talent, curiosity, and good relations with siblings. Short journeys and media work suit you. Your quick mind turns everyday observations into ideas.",
"Mercury in the 4th gives an educated, thoughtful home life and interest in property or learning. The mother may be intellectual. Study from home works well, and domestic peace aids focus.",
"Mercury in the 5th gives a bright, playful intellect and skill in mathematics or speculation. Children bring joy. Teaching comes naturally, and your explanations make difficult ideas clear.",
"Mercury in the 6th gives analytical skill for service, health, or legal detail. You outthink opponents. Keep nerves calm with routine, and let methodical work be your competitive edge.",
"Mercury in the 7th gives a communicative partner and skill in negotiation. Partnerships thrive on conversation. Business dealings need clear paperwork, and dialogue resolves most conflicts.",
"Mercury in the 8th gives a research mind and interest in hidden knowledge. Gains through others are possible. Guard against worry and overthinking by grounding yourself in facts.",
"Mercury in the 9th gives philosophical intellect and fortune through learning. Teachers and publishing favor you. Travel broadens the mind, and your ideas carry weight with educated audiences.",
"Mercury in the 10th gives a career in communication, trade, or analysis. You rise through skill and adaptability. Public speaking suits you, and your professional reputation rests on competence.",
"Mercury in the 11th gives clever friends and gains through ideas and networks. Plans are inventive. Group projects reward you, and your social circle values your insight.",
"Mercury in the 12th gives a reflective, imaginative mind and interest in foreign or spiritual subjects. Work quietly and write down insights. Solitude sharpens your perception."
],
jupiter: [
"Jupiter in the 1st gives wisdom, optimism, and a respected personality. You are seen as trustworthy. Health and judgment are generally good, and your presence reassures others.",
"Jupiter in the 2nd gives pleasant speech, family values, and growing wealth. You are generous and attract support. Traditional learning favors you, and your advice on values is sought.",
"Jupiter in the 3rd gives courage guided by principle and good siblings. Initiative is thoughtful. Writing and teaching carry weight, and your efforts earn lasting respect.",
"Jupiter in the 4th gives happiness at home, property, and a wise mother figure. Inner peace comes naturally. Education is well supported, and your home becomes a place of learning.",
"Jupiter in the 5th gives intelligence, creativity, and joy through children. Speculation can favor you. Spiritual or scholarly interests deepen, and your guidance shapes young minds.",
"Jupiter in the 6th gives the ability to overcome rivals through fairness and skill in service or healing. Routine and discipline protect health. Integrity turns competitors into allies.",
"Jupiter in the 7th gives a wise, supportive partner and success in alliances. Marriage is generally fortunate. You counsel others well, and partnerships prosper through mutual respect.",
"Jupiter in the 8th gives interest in deeper knowledge and resilience through change. Gains through others are possible. Research and occult study attract you, and crises teach profound lessons.",
"Jupiter in the 9th is strong for fortune, dharma, mentors, and higher learning. You are a natural guide. Long journeys and philosophy bless you, and your faith inspires others.",
"Jupiter in the 10th gives a respected career and ethical leadership. You rise through wisdom and integrity. Teaching or advisory roles suit you, and your name carries trust.",
"Jupiter in the 11th gives loyal friends, fulfilled ambitions, and steady gains. Networks and elder siblings support you. Generosity returns to you multiplied, and your circle is dependable.",
"Jupiter in the 12th gives spiritual depth, compassion, and quiet generosity. Foreign lands may bless you. Solitude and service bring peace, and your kindness works unseen."
],
venus: [
"Venus in the 1st gives charm, beauty, and a graceful personality. You attract goodwill. Artistic taste shapes your style and choices, and people enjoy your company.",
"Venus in the 2nd gives sweet speech, family harmony, and growing comforts. You earn through beauty, art, or finance. Tastes are refined, and your home reflects your aesthetic sense.",
"Venus in the 3rd gives artistic skill with hands and pleasant siblings. Hobbies can become income. Short pleasures and travels delight you, and your creativity finds practical outlets.",
"Venus in the 4th gives a beautiful home, comforts, and vehicles. Domestic happiness is strong. Property and design interests flourish, and your living space nurtures everyone in it.",
"Venus in the 5th gives romance, creativity, and joy with children. Artistic talents shine. Love affairs carry charm but need steadiness, and your creative work wins hearts.",
"Venus in the 6th gives the ability to win opponents through charm and skill in service or health aesthetics. Keep indulgence in check. Diplomacy achieves what force cannot.",
"Venus in the 7th gives an attractive, loving partner and harmony in marriage. Partnerships bring comfort. Public dealings favor you, and your relationships are built on genuine affection.",
"Venus in the 8th gives deep passions and gains through partner or inheritance. Interest in the hidden arts is strong. Guard against excess, and let intensity deepen rather than consume.",
"Venus in the 9th gives fortune through culture, travel, and refined mentors. You love beauty in philosophy and art. Higher learning pleases you, and your worldview is gracious.",
"Venus in the 10th gives a graceful career, often in arts, luxury, or public relations. Reputation is polished. Creative professions reward you, and elegance becomes your professional signature.",
"Venus in the 11th gives charming friends and gains through social circles. Wishes are fulfilled pleasantly. Networks bring comfort, and your friendships are both warm and useful.",
"Venus in the 12th gives refined pleasures, foreign comforts, and a generous heart. Solitude can be luxurious. Spiritual art attracts you, and you give quietly without expecting return."
],
saturn: [
"Saturn in the 1st gives seriousness, endurance, and slow but solid growth. You mature early in outlook. Discipline shapes your personality, and time steadily improves your position.",
"Saturn in the 2nd gives careful speech and slow, steady wealth building. Family responsibilities weigh on you. Savings grow with patience, and your word gains weight with age.",
"Saturn in the 3rd gives persistent courage and dutiful siblings. Efforts pay off late but surely. Hands-on skills develop over time, and perseverance becomes your trademark.",
"Saturn in the 4th gives responsibilities at home and slow property gains. Inner peace comes with age. Serve the mother with patience, and domestic stability deepens gradually.",
"Saturn in the 5th gives a serious mind and delayed but deep creativity. Children need patient care. Speculation should be avoided, while disciplined study yields lasting mastery.",
"Saturn in the 6th is strong for service, discipline, and defeating rivals through persistence. Health improves with routine. Your work ethic is formidable, and duties are discharged faithfully.",
"Saturn in the 7th gives a mature, serious partner and delayed but stable marriage. Partnerships demand patience and clear commitments. Loyalty deepens with time and shared effort.",
"Saturn in the 8th gives longevity, research patience, and slow transformation. Handle shared resources carefully. Discipline protects vitality, and crises are weathered with quiet strength.",
"Saturn in the 9th gives a traditional, dutiful approach to dharma and mentors. Fortune ripens with time. Respect teachers, persist in study, and your principles will carry you far.",
"Saturn in the 10th gives a career built on perseverance and integrity. Authority comes with time and responsibility. Public roles reward patience, and your record speaks for itself.",
"Saturn in the 11th gives loyal older friends and slow but sure gains. Ambitions are realized through sustained effort. Your networks are serious, and your goals are achieved step by step.",
"Saturn in the 12th gives a need for solitude, foreign connections, and quiet service. Rest deeply. Expenses need discipline, charity brings peace, and retreat restores your strength."
],
rahu: [
"Rahu in the 1st gives ambition, magnetism, and an unconventional self image. You want to stand out. Foreign or modern influences shape you, and your presence is hard to ignore.",
"Rahu in the 2nd gives hunger for wealth and bold speech. Family values may clash with your ambitions. Earn ethically, avoid shortcuts, and let your resourcefulness work honestly.",
"Rahu in the 3rd gives daring, media skill, and success through bold initiative. Siblings may be unusual. Courage is your asset, and your communication reaches wide audiences.",
"Rahu in the 4th gives restlessness at home and foreign or unusual domestic situations. Property gains are possible. Ground yourself with routine, and create stability deliberately.",
"Rahu in the 5th gives unconventional creativity and fascination with the novel. Speculation is risky, so choose skill over chance. Guide children wisely, and channel originality productively.",
"Rahu in the 6th gives the drive to defeat rivals and skill in competitive or technical service. Foreign work connections help. Stay ethical, and let your intensity serve a worthy cause.",
"Rahu in the 7th gives unconventional partnerships and a magnetic spouse. Choose partners with clear eyes. Business alliances need written terms, and honesty keeps bonds strong.",
"Rahu in the 8th gives fascination with the hidden and sudden changes. Handle joint money carefully. Research and technology suit you, and transformation follows crisis.",
"Rahu in the 9th gives unorthodox beliefs and foreign mentors or travel. Question traditions respectfully. Fortune comes through unusual paths, and your worldview keeps expanding.",
"Rahu in the 10th gives ambition for status and success in modern or foreign careers. Rise can be sudden. Keep methods clean, protect your reputation, and let achievement be genuine.",
"Rahu in the 11th gives large networks and ambitious gains through unconventional means. Friends may be influential foreigners. Dream big, verify facts, and use connections wisely.",
"Rahu in the 12th gives foreign residence or work, vivid dreams, and hidden expenses. Spiritual practice grounds you. Serve quietly, and let solitude become a source of insight."
],
ketu: [
"Ketu in the 1st gives detachment, insight, and a spiritual or introspective nature. You question identity itself. Solitude clarifies you, and your quiet wisdom surprises others.",
"Ketu in the 2nd gives detachment from wealth and plain, honest speech. Family ties feel karmic. Value simplicity over accumulation, and find security in what cannot be taken.",
"Ketu in the 3rd gives quiet courage and skill in subtle or spiritual communication. Siblings may be distant. Act without seeking applause, and let your work speak softly.",
"Ketu in the 4th gives detachment from home comforts and inner restlessness. Peace comes from within, not property. Serve the mother selflessly, and find home in your own heart.",
"Ketu in the 5th gives spiritual intelligence and detachment from speculation. Children teach you surrender. Creative work with depth suits you, and insight matters more than applause.",
"Ketu in the 6th gives the ability to dissolve opposition quietly and skill in healing or service. Routine spiritual practice protects health. You win by not engaging in petty battles.",
"Ketu in the 7th gives detachment in partnership and a spiritual or unusual spouse. Expectations need softening. Partnerships teach surrender, and acceptance deepens love with time.",
"Ketu in the 8th gives deep insight into hidden matters and resilience through loss. Research and mysticism attract you. Let go gracefully, and transformation becomes liberation.",
"Ketu in the 9th gives questioning of dogma and direct spiritual experience. Mentors may be unconventional. Trust inner knowing over ritual, and walk your own sincere path.",
"Ketu in the 10th gives detachment from status and work with deeper meaning. Careers in research or service suit you. Fame is not the goal, and your contribution outlasts titles.",
"Ketu in the 11th gives detachment from crowds and selective friendships. Gains come without chasing. Serve ideals rather than ambitions, and keep your circle small and true.",
"Ketu in the 12th gives strong spiritual inclination, vivid inner life, and foreign or monastic connections. Meditation restores you deeply, and surrender brings profound peace."
]
};

/* ============ 27 Moon nakshatra portraits (mind and emotional nature) ============ */
const NAKSHATRA_PORTRAITS = [
/* Ashwini */ "Ashwini Moon gives a quick, healing mind and love of speed. Ruled by the celestial physicians, the Ashwini Kumaras, you have a natural gift for helping others recover, whether bodies or situations. You act fast, sometimes before thinking, and thrive on fresh starts.",
/* Bharani */ "Bharani Moon gives emotional depth and the power to bear great responsibility. Under Yama's gaze you understand limits, endings, and discipline. You carry burdens others avoid, and your creativity emerges after struggle. Learn to rest without guilt.",
/* Krittika */ "Krittika Moon gives a sharp, purifying mind. Ruled by Agni, fire, you cut through confusion and value honesty, even when it burns. You are a natural critic and refiner. Temper the blade with kindness, and your clarity becomes leadership.",
/* Rohini */ "Rohini Moon gives charm, beauty, and deep emotional magnetism. This is the Moon's favorite home, so feelings run rich and steady. You love comfort, art, and sensual pleasures. Guard against possessiveness; your loyalty is profound when trust is earned.",
/* Mrigashira */ "Mrigashira Moon gives a searching, restless mind, always following the next scent of interest. Like the deer it symbolizes, you are gentle but alert. Curiosity drives you; commitment needs conscious choice. You make a fine researcher or seeker.",
/* Ardra */ "Ardra Moon gives emotional intensity and the gift of breakthrough after storm. Ruled by Rudra, you feel things at full volume and transform through crisis. Others may find you stormy, but your insights after the rain are precious. Learn to let grief complete its work.",
/* Punarvasu */ "Punarvasu Moon gives optimism, forgiveness, and the ability to return and begin again. Under Aditi, the mother of gods, you bounce back from setbacks with faith intact. You are a natural counselor. Your challenge is repeating old patterns; your gift is renewal.",
/* Pushya */ "Pushya Moon gives devotion, nourishment, and quiet moral strength. Ruled by Brihaspati, the teacher of gods, you care for others like family and are trusted deeply. You thrive in roles of guidance and care. Do not let duty eclipse your own needs.",
/* Ashlesha */ "Ashlesha Moon gives a penetrating, intuitive mind that sees hidden motives. The serpent energy here grants insight into mysteries and psychology. You are private and protective of your inner circle. Use your perception to heal, not to entangle.",
/* Magha */ "Magha Moon gives dignity, pride in lineage, and natural authority. Connected to the ancestors, the Pitris, you feel the weight and blessing of those who came before. You lead best when you honor tradition while serving the present.",
/* Purva Phalguni */ "Purva Phalguni Moon gives charm, romance, and love of pleasure and art. Under Bhaga, god of delight, you enjoy life's sweetness and attract affection easily. You are generous with loved ones. Balance enjoyment with responsibility, and joy becomes lasting.",
/* Uttara Phalguni */ "Uttara Phalguni Moon gives loyalty, sincerity, and the strength of lasting friendship. Ruled by Aryaman, patron of unions, you keep promises and value steady bonds. You make an excellent partner and colleague. Your word is your bond; choose commitments wisely.",
/* Hasta */ "Hasta Moon gives skillful hands, wit, and the ability to manifest ideas into form. Under Savita, the inspirer, you are clever, resourceful, and good with detail. You laugh easily and work skillfully. Focus turns your dexterity into mastery.",
/* Chitra */ "Chitra Moon gives artistic brilliance and a love of the beautiful and the bold. Ruled by Vishvakarma, the divine architect, you design, adorn, and impress. You have strong personal magnetism. Remember that character outlasts ornament.",
/* Swati */ "Swati Moon gives independence, flexibility, and grace under change. Like wind through grass, ruled by Vayu, you bend without breaking. You value freedom and do well in trade or independent work. Root yourself in a few loyalties amid the movement.",
/* Vishakha */ "Vishakha Moon gives ambition, focus, and the drive to achieve a grand goal. Under Indra and Agni, you pursue objectives with single pointed energy. You can be impatient with slower souls. Aim your intensity at worthy ends.",
/* Anuradha */ "Anuradha Moon gives devotion, discipline, and success through friendship and cooperation. Ruled by Mitra, god of friendship, you build lasting alliances and honor commitments. You rise through steady, principled effort. Your loyalty is your fortune.",
/* Jyeshtha */ "Jyeshtha Moon gives seniority of spirit, protectiveness, and deep responsibility. Under Indra as chief, you carry authority and guard your own. You may feel older than your years. Use your seniority to shelter others, not to dominate.",
/* Mula */ "Mula Moon gives a probing mind that seeks roots and first causes. Ruled by Nirriti, you question foundations and are unafraid of uncomfortable truths. Research, healing, and philosophy suit you. When you uproot, replant something better.",
/* Purva Ashadha */ "Purva Ashadha Moon gives conviction, emotional courage, and the spirit of the invincible. Under Apas, the waters, your feelings run deep and your resolve is hard to shake. You inspire others by example. Keep pride from hardening into stubbornness.",
/* Uttara Ashadha */ "Uttara Ashadha Moon gives lasting achievement, integrity, and leadership that endures. Ruled by the Vishvadevas, you build for the long term and honor your word. Success comes later but stays. Patience is your superpower.",
/* Shravana */ "Shravana Moon gives the gift of listening and learning. Under Vishnu, the preserver, you absorb knowledge deeply and are respected for wisdom. You do well in counseling, teaching, and any field where attention matters. What you hear, you remember.",
/* Dhanishta */ "Dhanishta Moon gives rhythm, teamwork, and skill in music or coordinated effort. Ruled by the Vasus, you shine in groups and handle wealth and resources well. You are generous and social. Keep your pace sustainable and share credit.",
/* Shatabhisha */ "Shatabhisha Moon gives independence, healing insight, and comfort with the unconventional. Under Varuna, lord of cosmic order and waters, you see patterns others miss. You value solitude and science. Your solitude is productive; share its fruits.",
/* Purva Bhadrapada */ "Purva Bhadrapada Moon gives intensity, idealism, and a fiery devotion to principle. Ruled by Aja Ekapada, you feel things absolutely and fight for what you believe. You can be extreme; channel the fire into transformation, not destruction.",
/* Uttara Bhadrapada */ "Uttara Bhadrapada Moon gives depth, stillness, and spiritual wisdom. Under Ahirbudhnya, the serpent of the deep, your inner life is profound and steady. You are the calm center in crisis. Solitude and contemplation recharge you fully.",
/* Revati */ "Revati Moon gives compassion, gentleness, and a protective love for all beings. Ruled by Pushan, the nourisher and guide of travelers, you help others find their way. You are loved for your kindness. Guard your soft heart with wise boundaries."
];

/* ============ 9 Mahadasha portraits (~120 words each) ============ */
const DASHA_PORTRAITS = {
Sun: "The Sun's major period turns the spotlight onto identity, career, and authority. Classical texts associate this dasha with rise in status, connection to government or father figures, and a stronger sense of purpose. You may take on leadership, seek recognition, or clarify who you are becoming. Health and vitality get attention, and self discipline pays well. If the Sun is strong in your chart, expect visible advancement and the confidence to carry it. If weak or afflicted, the same years can bring ego clashes or friction with authority, asking you to lead through service rather than pride. The traditional counsel is to act with integrity in public roles and honor mentors and elders.",
Moon: "The Moon's major period centers the inner life: emotions, family, mother, and peace of mind. Classical texts describe this dasha as a time of emotional growth, domestic focus, and fluctuating but ultimately nourishing fortunes. You may move homes, deepen family bonds, or discover what truly comforts you. Public or care related work can prosper. A strong Moon brings popularity, mental clarity, and supportive relationships. A weak or afflicted Moon asks for steadier routines, rest, and emotional honesty instead of suppression. The traditional counsel is to protect your sleep, your diet, and your closest bonds, since the mind is the instrument through which this entire period is experienced.",
Mars: "Mars's major period brings energy, courage, and the drive to act. Classical texts associate this dasha with initiative, property, technical skill, and victory through effort. You may start ventures, buy land or vehicles, or take up physical disciplines. Competition favors the bold, but haste is the shadow side: accidents, arguments, and burnout come from unmanaged fire. A strong Mars gives leadership in enterprise and the stamina to finish hard things. A weak Mars asks for patience and channeled outlets like sport or craft. The traditional counsel is to think before striking, keep promises to siblings and partners, and let courage serve construction rather than conflict.",
Mercury: "Mercury's major period sharpens the intellect and opens doors through knowledge and communication. Classical texts link this dasha to education, trade, writing, and skillful negotiation. Students flourish, businesses grow through ideas, and networks expand. It is an excellent time to learn a craft, publish, or start a knowledge based venture. A strong Mercury brings wit, adaptability, and commercial success. A weak or afflicted Mercury warns against overthinking, gossip, and scattered efforts. The traditional counsel is to finish courses you start, speak precisely, and let your skill, not your cleverness, do the persuading.",
Jupiter: "Jupiter's major period is traditionally the most benevolent: wisdom, mentors, fortune, and expansion. Classical texts associate this dasha with marriage, children, higher learning, and spiritual growth. Teachers appear, opportunities widen, and long term plans mature. It favors education, counseling, law, finance, and advisory roles. A strong Jupiter brings protection even in difficulty and the respect of others. A weak Jupiter asks for humility: avoid preaching, overspending, or overpromising. The traditional counsel is to study, to teach what you learn, and to keep faith during the slower stretches, since Jupiter rewards those who grow steadily rather than grasp quickly.",
Venus: "Venus's major period brings comfort, relationships, and the enjoyment of life's refinements. Classical texts associate this dasha with love, marriage, arts, luxury, and gains through partnership or beauty related work. It is a time when relationships deepen and material comforts increase. Creative talents find audiences. A strong Venus gives harmony at home and success in aesthetics, hospitality, or finance. A weak or afflicted Venus warns against overindulgence, extravagance, or romantic confusion. The traditional counsel is to invest in real intimacy rather than mere pleasure, keep agreements clear in partnerships, and let appreciation, not acquisition, be the theme.",
Saturn: "Saturn's major period is the great teacher: discipline, responsibility, and slow building. Classical texts describe this dasha as demanding but ultimately rewarding for those who work honestly. Careers consolidate, long delayed efforts mature, and character deepens. It is less about sudden gains and more about foundations that last. A strong Saturn brings promotion, authority, and the respect earned through service. A weak Saturn can bring delays, heavy duties, or health warnings that ask for simpler living. The traditional counsel is to accept the workload without resentment, serve elders and juniors alike, and remember that Saturn pays compound interest on every honest effort.",
Rahu: "Rahu's major period brings ambition, foreign connections, and unconventional paths. Classical texts describe this dasha as worldly and intense: sudden rises, fascination with technology or distant lands, and desires that push beyond old boundaries. It can open remarkable doors in modern careers, media, and cross cultural work. The shadow side is illusion: shortcuts, speculation, or confusing intensity with progress. A well placed Rahu gives innovation and courage to break molds. An afflicted Rahu asks for grounding routines and honest counsel. The traditional counsel is to verify before you leap, keep your methods clean, and use the period's hunger as fuel for genuine mastery rather than mere display.",
Ketu: "Ketu's major period turns attention inward: detachment, insight, and spiritual refinement. Classical texts associate this dasha with letting go, research, and the loosening of old attachments. Worldly ambitions may feel hollow while inner questions grow louder. It favors study, meditation, healing work, and any pursuit of depth over display. Material plans can stall, not to punish but to redirect. A well placed Ketu grants intuition, past life talents surfacing, and freedom from compulsion. An afflicted Ketu asks for care with health routines and against escapism. The traditional counsel is to simplify, to serve without seeking credit, and to treat losses of the outer as gains of the inner."
};

function getAntardashaLine(lord) {
  var lines = {
    Sun: "brings focus and authority to the foreground; a time to lead visibly and act with integrity.",
    Moon: "softens the period toward family, rest, and emotional honesty; nurture close bonds.",
    Mars: "adds drive and urgency; channel it into work and fitness, not arguments.",
    Mercury: "sharpens thinking and communication; good for study, writing, and trade.",
    Jupiter: "brings guidance and expansion; seek mentors and think long term.",
    Venus: "adds comfort and harmony; relationships and creative pursuits flourish.",
    Saturn: "asks for patience and steady effort; foundations laid now will last.",
    Rahu: "intensifies ambition and unconventional moves; verify facts before leaping.",
    Ketu: "turns attention inward; simplify, reflect, and release what is finished."
  };
  return lines[lord] || "";
}

/* ============ Dignity and condition modifiers (programmatic, spec 13.2) ============ */
var EXALT_SIGN = {sun:0, moon:1, mars:9, mercury:5, jupiter:3, venus:11, saturn:6};
var DEBIL_SIGN = {sun:6, moon:7, mars:3, mercury:11, jupiter:9, venus:5, saturn:0};
var OWN_SIGNS_I = {sun:[4], moon:[3], mars:[0,7], mercury:[2,5], jupiter:[8,11], venus:[1,6], saturn:[9,10]};
var COMBUST_ORB = {moon:12, mars:17, mercury:14, jupiter:11, venus:10, saturn:15};

function planetIsRetrograde(key, jd) {
  if (typeof jd !== 'number') return false;
  if (key === 'sun' || key === 'moon') return false;
  try {
    if (typeof planetSidereal === 'undefined') return false;
    var map = {mars:'mar', mercury:'mer', jupiter:'jup', venus:'ven', saturn:'sat'};
    var a = planetSidereal(map[key], jd - 0.5), b = planetSidereal(map[key], jd + 0.5);
    var d = (b - a) % 360; if (d < 0) d += 360;
    return d > 180;
  } catch (e) { return false; }
}

// Returns short modifier clauses for a planet, grounded in computed facts.
function getPlanetModifiers(key, lon, sunLon, jd) {
  var mods = [], s = signOf(lon);
  if (EXALT_SIGN[key] === s) mods.push('exalted, giving its strongest expression');
  else if (DEBIL_SIGN[key] === s) mods.push('debilitated, so its significations need conscious effort (check Neecha Bhanga cancellations)');
  else if (OWN_SIGNS_I[key] && OWN_SIGNS_I[key].indexOf(s) >= 0) mods.push('in its own sign, steady and reliable');
  if (typeof sunLon === 'number' && key !== 'sun' && COMBUST_ORB[key]) {
    var d = Math.abs(lon - sunLon) % 360; if (d > 180) d = 360 - d;
    var orb = COMBUST_ORB[key];
    if (planetIsRetrograde(key, jd) && (key === 'mercury' || key === 'venus')) orb -= 2;
    if (d < orb) mods.push('combust (close to the Sun), so its voice is quieter and works best behind a strong Sun');
  }
  if (planetIsRetrograde(key, jd)) mods.push('retrograde, turning its energy inward: revisit, refine, and expect some delay before results show');
  return mods;
}

/* ============ Traditional remedies (belief-labeled, spec 14) ============ */
const REMEDY_HEADER = "Traditional beliefs, not advice. The practices below come from classical Jyotish tradition. They are cultural and spiritual customs, not medical, financial, or legal prescriptions. Nothing here replaces professional guidance.";
const REMEDIES_FULL = {
  sun: {title: "Sun", items: ["Offer water to the rising Sun in the morning, a traditional Surya practice.", "Recite Om Suryaya Namah or the Aditya Hridaya Stotra on Sundays.", "Donate wheat, copper, or jaggery on Sundays.", "Honor father figures and teachers. Traditional gemstone: ruby (Manikya)."]},
  moon: {title: "Moon", items: ["Spend calm time near water; keep Monday evenings peaceful.", "Recite Om Chandraya Namah on Mondays.", "Donate rice, milk, or white cloth on Mondays.", "Care for the mother and nurture emotional steadiness. Traditional gemstone: pearl (Moti)."]},
  mars: {title: "Mars", items: ["Hanuman worship and the Hanuman Chalisa on Tuesdays.", "Physical exercise to channel energy constructively.", "Donate red lentils (masoor) or jaggery on Tuesdays.", "Avoid unnecessary conflict, especially on Tuesdays. Traditional gemstone: red coral (Moonga)."]},
  mercury: {title: "Mercury", items: ["Vishnu or Ganesha worship; recite Om Budhaya Namah on Wednesdays.", "Read, study, and speak truthfully.", "Donate green gram or green cloth; help students on Wednesdays.", "Traditional gemstone: emerald (Panna)."]},
  jupiter: {title: "Jupiter", items: ["Honor teachers and elders; recite Om Gurave Namah on Thursdays.", "Read wisdom texts; keep Thursday routines calm and generous.", "Donate turmeric, chana dal, or yellow cloth on Thursdays.", "Traditional gemstone: yellow sapphire (Pukhraj)."]},
  venus: {title: "Venus", items: ["Lakshmi worship; recite Om Shukraya Namah on Fridays.", "Appreciate arts and keep surroundings clean and beautiful.", "Donate rice, sugar, or white silk on Fridays.", "Nurture relationships with honesty. Traditional gemstone: diamond (Heera)."]},
  saturn: {title: "Saturn", items: ["Shani or Hanuman worship; recite Om Sham Shanicharaya Namah on Saturdays.", "Serve elders and work with patience and discipline.", "Donate black sesame, iron, or black cloth on Saturdays.", "Right conduct itself is the classical remedy for Saturn. Traditional gemstone: blue sapphire (Neelam)."]},
  rahu: {title: "Rahu", items: ["Durga worship on Saturdays or during Rahu Kalam.", "Donate black gram (urad) or blankets to those in need.", "Avoid shortcuts and speculative risks.", "Stay grounded with routine and honest work. Traditional gemstone: hessonite (Gomed)."]},
  ketu: {title: "Ketu", items: ["Ganesha worship; meditate regularly.", "Donate horse gram (kulthi) or mixed grains.", "Let go of grudges; spend time in nature.", "Simplify life and serve without seeking credit. Traditional gemstone: cat's eye (Lehsunia)."]}
};
const GEMSTONE_NOTE = "On gemstones: tradition recommends them only after consultation with a qualified astrologer and a certified gemologist. They are never a medical or financial recommendation.";

function getRemediesSection(weakPlanets) {
  var lines = [REMEDY_HEADER, ""];
  var keys = (weakPlanets && weakPlanets.length) ? weakPlanets : PLANET_KEYS;
  keys.forEach(function (k) {
    var r = REMEDIES_FULL[k];
    if (!r) return;
    lines.push(r.title + ":");
    r.items.forEach(function (it) { lines.push("  - " + it); });
    lines.push("");
  });
  lines.push(GEMSTONE_NOTE);
  return lines.join("\n");
}

/* ============ Structured Q&A (spec 13.1) ============ */
function getQASection() {
  return [
    {
      q: "What does the chart suggest about career?",
      factors: "10th house and its lord, Saturn and Jupiter, D10 Dashamsha, current Mahadasha lord",
      a: "Classical texts judge career from the 10th house, its lord's dignity and placement, the strength of Saturn (service and perseverance) and Jupiter (guidance and fortune), and the Dashamsha chart. The running Mahadasha shows which theme is active now. Read the 10th lord's house placement: for example, the 10th lord in the 9th traditionally suggests fortune through mentors or dharma-linked work. This is a reflective reading, not a job guarantee; effort and skill remain decisive."
    },
    {
      q: "What does the chart suggest about marriage and relationships?",
      factors: "7th house and its lord, Venus (and Jupiter for women in classical texts), Moon, D9 Navamsha, Mangal check",
      a: "Classical texts judge partnership from the 7th house, its lord, Venus as the natural significator of love, and the Navamsha chart for the deeper promise. The Mangal (Kuja) dosha check and its cancellations belong here too. Timing traditionally combines the 7th lord's dasha with Jupiter's transit. Treat all of this as insight into relationship patterns and timing tendencies, never as a final judgment on any person or union."
    },
    {
      q: "What does the chart suggest about wealth?",
      factors: "2nd and 11th houses and lords, Dhana yogas (2nd/5th/9th/11th lords in sambandha), Jupiter, D2 Hora",
      a: "Classical texts judge wealth from the 2nd house (accumulated resources) and 11th (gains), their lords' strength, Dhana yogas formed by lords of the 2nd, 5th, 9th and 11th in mutual connection, and the Hora chart. Jupiter's condition colors the whole picture. Dashas show timing windows. This describes earning patterns and attitudes toward money, not a promise of riches; it is not financial advice."
    },
    {
      q: "What does the chart suggest about education?",
      factors: "5th house (intellect) and 9th (higher learning), Mercury and Jupiter, Saraswati-associated placements",
      a: "Classical texts judge learning from the 5th house (intellect and discernment) and 9th (higher knowledge and mentors), with Mercury for analytical skill and Jupiter for wisdom. The dasha sequence shows fertile and fallow periods for study. Strong combinations suggest depth in a chosen field; weaker ones suggest learning through persistence rather than ease. Either way, sustained study outweighs any chart factor."
    },
    {
      q: "What does the chart suggest about foreign travel or settlement?",
      factors: "12th house (foreign lands), 9th (long journeys), Rahu, Moon, D9/D10 confirmation",
      a: "Classical texts connect foreign residence with the 12th house, long journeys with the 9th, Rahu with foreign or unconventional environments, and the Moon with movement. Confirmation from the Navamsha and Dashamsha strengthens the reading. Dashas of the 12th or 9th lords, or Rahu, often coincide with such moves. This is a tendency reading for reflection, not a travel directive."
    },
    {
      q: "What does the chart suggest about health?",
      factors: "1st house and its lord, Moon (mind), 6th house (symbolic)",
      a: "A note before the reading: this is symbolic only and never medical advice. Classical texts view the 1st house and its lord as vitality, the Moon as mental peace, and the 6th house as the symbolic zone of imbalance. Afflictions here traditionally suggest paying attention to rest, routine, and stress rather than predicting illness. For any real health concern, consult a qualified medical professional. The useful takeaway is lifestyle: regular sleep, moderate food, and calm routines support whatever the chart shows."
    }
  ];
}

/* ============ Getters ============ */
function getLagnaPortrait(signIndex) {
  return LAGNA_PORTRAITS[((signIndex % 12) + 12) % 12] || "";
}
function getPlanetInHouse(planetKey, houseIndex1to12, shadbala) {
  var arr = PLANET_HOUSE[planetKey];
  if (!arr) return "";
  var text = arr[(((houseIndex1to12 - 1) % 12) + 12) % 12] || "";
  // Optional classical strength note: when a Shadbala result is supplied and the
  // planet exceeds 1.25x its classical minimum, say so explicitly.
  if (shadbala && shadbala[planetKey] && shadbala[planetKey].ratio > 1.25) {
    text += " Classical strength: strong (" + shadbala[planetKey].ratio.toFixed(1) +
      " times the classical minimum).";
  }
  return text;
}
function getDashaPortrait(lord) {
  var key = (lord || "").toLowerCase();
  var cap = key.charAt(0).toUpperCase() + key.slice(1);
  return DASHA_PORTRAITS[cap] || "";
}
function getMoonNakshatraPortrait(moonLong) {
  var idx = Math.floor((((moonLong % 360) + 360) % 360) / (360 / 27)) % 27;
  return {name: NAKSHATRAS[idx], index: idx, text: NAKSHATRA_PORTRAITS[idx]};
}

/* ============ Preserved original exports (unchanged behavior) ============ */
const INTERP = {
  // Lagna interpretations (short versions; full portraits via getLagnaPortrait)
  lagna: [
    "Aries rising gives a direct and energetic approach to life. You tend to start things with enthusiasm.",
    "Taurus rising gives steadiness and patience. You build things to last and value security.",
    "Gemini rising gives curiosity and adaptability. You learn quickly and communicate well.",
    "Cancer rising gives sensitivity and care for others. Home and family matter deeply.",
    "Leo rising gives warmth and natural leadership. You shine when you can be generous.",
    "Virgo rising gives attention to detail and a helpful nature. You improve what you touch.",
    "Libra rising gives a sense of fairness and harmony. You bring people together.",
    "Scorpio rising gives intensity and insight. You see what others miss.",
    "Sagittarius rising gives optimism and a love of learning. You think big.",
    "Capricorn rising gives discipline and long term vision. You achieve through persistence.",
    "Aquarius rising gives originality and care for the collective. You think ahead of your time.",
    "Pisces rising gives compassion and imagination. You feel deeply and create beautifully."
  ],

  // Planet in sign (generic fallback; detailed planet-in-house via getPlanetInHouse)
  planetInSign: function(planet, sign) {
    const p = PLANETS[planet] || planet;
    const s = SIGNS[sign];
    return `${p} in ${s} shapes how this planet expresses in your chart. See the detailed analysis below for what this means for you.`;
  },

  // Dasha interpretations (short; full portraits via getDashaPortrait)
  dasha: {
    Sun: "Sun period brings focus on self, career, and authority. Good for taking leadership and working with government or father figures.",
    Moon: "Moon period brings focus on mind, mother, and emotional well being. Good for inner growth and family matters.",
    Mars: "Mars period brings energy and drive. Good for courage, property, and taking initiative. Channel energy constructively.",
    Mercury: "Mercury period brings focus on learning, business, and communication. Good for studies, trade, and intellectual work.",
    Jupiter: "Jupiter period brings wisdom and expansion. Good for teachers, mentors, marriage, and spiritual growth.",
    Venus: "Venus period brings comfort and relationships. Good for love, arts, luxury, and partnerships.",
    Saturn: "Saturn period brings discipline and hard work. Good for long term building, service, and learning patience.",
    Rahu: "Rahu period brings ambition and unconventional paths. Good for foreign connections, technology, and breaking old patterns.",
    Ketu: "Ketu period brings detachment and insight. Good for spiritual practice, research, and letting go of what no longer serves."
  },

  // Remedies (traditional beliefs, not prescriptions)
  remedies: {
    Sun: "Traditional belief: Offer water to the Sun at sunrise, respect father figures.",
    Moon: "Traditional belief: Spend time near water, care for mother, keep calm on Mondays.",
    Mars: "Traditional belief: Exercise regularly, help siblings, avoid unnecessary conflict on Tuesdays.",
    Mercury: "Traditional belief: Read and learn, speak truthfully, help students on Wednesdays.",
    Jupiter: "Traditional belief: Respect teachers, read wisdom texts, help others on Thursdays.",
    Venus: "Traditional belief: Appreciate arts, keep clean, nurture relationships on Fridays.",
    Saturn: "Traditional belief: Serve elders, work diligently, be patient on Saturdays.",
    Rahu: "Traditional belief: Help those in need, avoid shortcuts, stay grounded.",
    Ketu: "Traditional belief: Meditate, let go of grudges, spend time in nature."
  },

  disclaimer: "This reading is for reflection and entertainment. It is not scientific certainty, medical advice, or a guarantee of future events. Traditional remedies are cultural beliefs, not prescriptions. For health concerns, consult a qualified professional."
};

function getLagnaInterp(ascLong) {
  return INTERP.lagna[signOf(ascLong)];
}

function getDashaInterp(lord) {
  return INTERP.dasha[lord] || "";
}

function getRemedy(planet) {
  return INTERP.remedies[planet] || "";
}

/* expose new API alongside the originals */
if (typeof window !== 'undefined') {
  window.getLagnaPortrait = getLagnaPortrait;
  window.getPlanetInHouse = getPlanetInHouse;
  window.getDashaPortrait = getDashaPortrait;
  window.getAntardashaLine = getAntardashaLine;
  window.getMoonNakshatraPortrait = getMoonNakshatraPortrait;
  window.getRemediesSection = getRemediesSection;
  window.getQASection = getQASection;
  window.getPlanetModifiers = getPlanetModifiers;
  window.LAGNA_PORTRAITS = LAGNA_PORTRAITS;
  window.PLANET_HOUSE = PLANET_HOUSE;
  window.DASHA_PORTRAITS = DASHA_PORTRAITS;
  window.NAKSHATRA_PORTRAITS = NAKSHATRA_PORTRAITS;
  window.REMEDY_HEADER = REMEDY_HEADER;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SIGNS, NAKSHATRAS, PLANETS, PLANET_KEYS, signOf, degreeInSign, INTERP,
    getLagnaInterp, getDashaInterp, getRemedy,
    getLagnaPortrait, getPlanetInHouse, getDashaPortrait, getAntardashaLine,
    getMoonNakshatraPortrait, getRemediesSection, getQASection, getPlanetModifiers,
    LAGNA_PORTRAITS, PLANET_HOUSE, DASHA_PORTRAITS, NAKSHATRA_PORTRAITS, REMEDY_HEADER
  };
}

/* ============ Life reading: name, past verdict, guidance, questions ============
   Built for visitors who want answers about their life, not chart jargon.
   All readings are traditional belief for reflection, never fixed predictions.
*/

var LIFE_SIGN_NAMES = ['Aries','Taurus','Gemini','Cancer','Leo','Virgo','Libra','Scorpio','Sagittarius','Capricorn','Aquarius','Pisces'];
var CLASSICAL_SIGN_LORDS = ['Mars','Venus','Mercury','Moon','Sun','Mercury','Venus','Mars','Jupiter','Saturn','Saturn','Jupiter'];
var PLANET_KEYS_LOWER = ['sun','moon','mars','mercury','jupiter','venus','saturn','rahu','ketu'];
var PLANET_NAMES_CAP = ['Sun','Moon','Mars','Mercury','Jupiter','Venus','Saturn','Rahu','Ketu'];

function lifeHouseOf(p, planetKey) {
  var ascS = Math.floor((((p.ascendant % 360) + 360) % 360) / 30) % 12;
  var ps = Math.floor((((p[planetKey] % 360) + 360) % 360) / 30) % 12;
  return (((ps - ascS) % 12) + 12) % 12 + 1;
}
function lifeHouseSign(p, houseNum) {
  var ascS = Math.floor((((p.ascendant % 360) + 360) % 360) / 30) % 12;
  return (ascS + houseNum - 1) % 12;
}
function lifeHouseLord(p, houseNum) {
  return CLASSICAL_SIGN_LORDS[lifeHouseSign(p, houseNum)];
}
function lifeLordHouse(p, lordName) {
  return lifeHouseOf(p, lordName.toLowerCase());
}
function lifeNowJD() {
  return Date.now() / 86400000 + 2440587.5;
}
function lifeOrdinal(n) {
  if (n === 1) return '1st'; if (n === 2) return '2nd'; if (n === 3) return '3rd';
  return n + 'th';
}

/* ---- Birth-name syllable from Moon nakshatra pada (eastern tradition) ---- */
var NAKSHATRA_PADA_SYLLABLES = [
  ["Chu","Che","Cho","La"], ["Li","Lu","Le","Lo"], ["A","I","U","E"],
  ["O","Va","Vi","Vu"], ["Ve","Vo","Ka","Ki"], ["Ku","Gha","Ng","Chha"],
  ["Ke","Ko","Ha","Hi"], ["Hu","He","Ho","Da"], ["Di","Du","De","Do"],
  ["Ma","Mi","Mu","Me"], ["Mo","Ta","Ti","Tu"], ["Te","To","Pa","Pi"],
  ["Pu","Sha","Na","Tha"], ["Pe","Po","Ra","Ri"], ["Ru","Re","Ro","Ta"],
  ["Ti","Tu","Te","To"], ["Na","Ni","Nu","Ne"], ["No","Ya","Yi","Yu"],
  ["Ye","Yo","Bha","Bhi"], ["Bhu","Dha","Pha","Dha"], ["Bhe","Bho","Ja","Ji"],
  ["Ju","Je","Jo","Gha"], ["Ga","Gi","Gu","Ge"], ["Go","Sa","Si","Su"],
  ["Se","So","Da","Di"], ["Du","Tha","Jha","Na"], ["De","Du","Cha","Chi"]
];
function getBirthNameSyllable(moonLong) {
  var padaLen = 360 / 108;
  var padaIndex = Math.floor(((((moonLong % 360) + 360) % 360) / padaLen)) % 108;
  var nakIdx = Math.floor(padaIndex / 4);
  var pada = (padaIndex % 4) + 1;
  return {
    nakshatra: (typeof NAKSHATRAS !== 'undefined' ? NAKSHATRAS[nakIdx] : LIFE_SIGN_NAMES[nakIdx % 12]),
    pada: pada,
    syllable: NAKSHATRA_PADA_SYLLABLES[nakIdx][pada - 1]
  };
}

/* ---- Past verdict: Mahadashas already lived through ---- */
function getPastVerdict(moonLong, birthJD, nowJD) {
  var seq = vimshottariMahadashas(moonLong, birthJD);
  var past = [], current = null;
  seq.forEach(function(d) {
    if (d.endJD <= nowJD) past.push(d);
    else if (!current && d.startJD <= nowJD) current = d;
  });
  return { past: past, current: current };
}
function renderPastVerdict(moonLong, birthJD) {
  var nowJD = lifeNowJD();
  var v = getPastVerdict(moonLong, birthJD, nowJD);
  var html = '<h3>Your life so far</h3>';
  html += '<p>Traditional Jyotish reads the chapters of a life from the Vimshottari dasha sequence. '
    + 'Read the chapters below against your own memory. If the themes match the years you lived, '
    + 'the timing method is working for your chart.</p>';
  if (!v.past.length) {
    html += '<p>You are still living your very first Mahadasha, so there is no completed chapter yet. '
      + 'The current chapter is described under your dasha forecast below.</p>';
  } else {
    html += '<div class="past-chapters">';
    v.past.forEach(function(d) {
      var theme = (typeof getDashaPortrait !== 'undefined') ? getDashaPortrait(d.lord) : '';
      var firstSentence = theme ? theme.split('. ')[0] + '.' : '';
      html += '<div class="past-chapter"><p><strong>' + d.lord + ' Mahadasha, '
        + formatDate(d.startJD) + ' to ' + formatDate(d.endJD) + ':</strong> '
        + firstSentence + '</p></div>';
    });
    html += '</div>';
  }
  if (v.current) {
    html += '<p><strong>Current chapter:</strong> ' + v.current.lord + ' Mahadasha, running until '
      + formatDate(v.current.endJD) + '.</p>';
  }
  return html;
}

/* ---- Plain-language life guidance ---- */
function getLifeGuidance(p, moonLong, birthJD) {
  var g = {};
  var h7lord = lifeHouseLord(p, 7), h7lordHouse = lifeLordHouse(p, h7lord);
  var venusHouse = lifeHouseOf(p, 'venus');
  g.relationships =
    'Relationships are read from your 7th house (' + LIFE_SIGN_NAMES[lifeHouseSign(p, 7)] + '), whose lord '
    + h7lord + ' sits in your ' + lifeOrdinal(h7lordHouse) + ' house, and from Venus in your '
    + lifeOrdinal(venusHouse) + ' house. Classical counsel: the 7th house rewards listening over winning; '
    + 'partnerships steady when both people keep their own friendships and work. '
    + 'Practical tip: in disagreements, state what you felt before what the other person did.';
  var h6lord = lifeHouseLord(p, 6);
  var moonHouse = lifeHouseOf(p, 'moon');
  g.health =
    'Health in Jyotish is symbolic, never medical: it is read from the 6th house (' + LIFE_SIGN_NAMES[lifeHouseSign(p, 6)]
    + '), its lord ' + h6lord + ', and the Moon, which sits in your ' + lifeOrdinal(moonHouse)
    + ' house and governs rest and emotional steadiness. Nothing here replaces a doctor. '
    + 'Practical tip from the tradition: protect sleep first, because the Moon chapters of life are the ones where rest decides everything.';
  var h10lord = lifeHouseLord(p, 10), h10lordHouse = lifeLordHouse(p, h10lord);
  var saturnHouse = lifeHouseOf(p, 'saturn');
  g.career =
    'Work is read from your 10th house (' + LIFE_SIGN_NAMES[lifeHouseSign(p, 10)] + '), whose lord '
    + h10lord + ' sits in your ' + lifeOrdinal(h10lordHouse) + ' house, with Saturn in your '
    + lifeOrdinal(saturnHouse) + ' house shaping how you handle responsibility. The tradition respects slow-built '
    + 'skill over quick wins for this placement. Practical tip: one visible, finished piece of work per quarter '
    + 'builds the 10th house faster than ten half-done efforts.';
  var h2lord = lifeHouseLord(p, 2), h11lord = lifeHouseLord(p, 11);
  var jupiterHouse = lifeHouseOf(p, 'jupiter');
  g.money =
    'Resources are read from your 2nd house (' + LIFE_SIGN_NAMES[lifeHouseSign(p, 2)] + ', lord ' + h2lord
    + ') and 11th house of gains (' + LIFE_SIGN_NAMES[lifeHouseSign(p, 11)] + ', lord ' + h11lord
    + '), with Jupiter in your ' + lifeOrdinal(jupiterHouse) + ' house. Classical counsel: wealth in this chart '
    + 'grows through steadiness and counsel, not speculation. Practical tip: automate a fixed saving amount, '
    + 'however small, and let time do what timing cannot.';
  return g;
}
function renderLifeGuidance(p, moonLong, birthJD) {
  var g = getLifeGuidance(p, moonLong, birthJD);
  var html = '<h3>Guidance for life areas</h3>'
    + '<p>Plain-language counsel drawn from your chart. Traditional belief for reflection, not fixed prediction.</p>'
    + '<div class="guidance-grid">'
    + '<div class="guidance-card"><h4>Relationships</h4><p>' + g.relationships + '</p></div>'
    + '<div class="guidance-card"><h4>Health (symbolic)</h4><p>' + g.health + '</p></div>'
    + '<div class="guidance-card"><h4>Career</h4><p>' + g.career + '</p></div>'
    + '<div class="guidance-card"><h4>Money</h4><p>' + g.money + '</p></div>'
    + '</div>';
  return html;
}

/* ---- Ask your question: keyword-routed chart answers ---- */
var QUESTION_TOPICS = [
  { id: 'career', keys: ['career','job','work','business','promotion','profession','interview','service'] },
  { id: 'marriage', keys: ['marr','wedding','wife','husband','spouse','partner','love','relationship','divorce','romance'] },
  { id: 'health', keys: ['health','body','ill','disease','sick','medical','hospital','weight','sleep'] },
  { id: 'money', keys: ['money','wealth','rich','financ','debt','loan','income','salary','property','invest'] },
  { id: 'timing', keys: ['when','timing','period','dasha','mahadasha','antardasha','next','future','year'] },
  { id: 'children', keys: ['child','children','baby','pregnan','son','daughter','kid'] },
  { id: 'education', keys: ['stud','exam','education','degree','college','school','learn','university'] }
];
function detectTopic(q) {
  var s = String(q).toLowerCase();
  for (var i = 0; i < QUESTION_TOPICS.length; i++) {
    var t = QUESTION_TOPICS[i];
    for (var j = 0; j < t.keys.length; j++) {
      try {
        if (new RegExp('\\b' + t.keys[j]).test(s)) return t.id;
      } catch (e) { if (s.indexOf(t.keys[j]) >= 0) return t.id; }
    }
  }
  return null;
}
function answerFreeQuestion(question, p, moonLong, birthJD) {
  var topic = detectTopic(question);
  var g = getLifeGuidance(p, moonLong, birthJD);
  var nowJD = lifeNowJD();
  var v = getPastVerdict(moonLong, birthJD, nowJD);
  var timingLine = v.current
    ? 'You are currently in ' + v.current.lord + ' Mahadasha until ' + formatDate(v.current.endJD) + '.'
    : '';
  var answers = {
    career: g.career + ' ' + timingLine,
    marriage: g.relationships + ' ' + timingLine,
    health: g.health,
    money: g.money + ' ' + timingLine,
    timing: 'Timing in Jyotish comes from the Vimshottari sequence. ' + timingLine
      + ' Read the current chapter as the active theme: matters of that planet rise to the surface now.',
    children: 'Children are read from your 5th house (' + LIFE_SIGN_NAMES[lifeHouseSign(p, 5)] + '), whose lord '
      + lifeHouseLord(p, 5) + ' sits in your ' + lifeOrdinal(lifeLordHouse(p, lifeHouseLord(p, 5)))
      + ' house, with Jupiter in your ' + lifeOrdinal(lifeHouseOf(p, 'jupiter')) + ' house. '
      + 'The tradition links this combination to guidance given and received across generations. ' + timingLine,
    education: 'Learning is read from Mercury in your ' + lifeOrdinal(lifeHouseOf(p, 'mercury'))
      + ' house and Jupiter in your ' + lifeOrdinal(lifeHouseOf(p, 'jupiter'))
      + ' house, with the 4th house (' + LIFE_SIGN_NAMES[lifeHouseSign(p, 4)] + ') showing the foundation. '
      + 'Classical counsel: this chart favors depth in one field over breadth in many. ' + timingLine
  };
  if (!topic) {
    return {
      topic: null,
      answer: 'I can reflect on career, marriage and relationships, health, money, timing, children, or education '
        + 'from your chart. Try asking with one of those words, for example: "what about my career?"'
    };
  }
  return {
    topic: topic,
    answer: answers[topic] + ' This is a traditional reading for reflection, not a fixed prediction.'
  };
}

if (typeof window !== 'undefined') {
  window.getBirthNameSyllable = getBirthNameSyllable;
  window.renderPastVerdict = renderPastVerdict;
  window.renderLifeGuidance = renderLifeGuidance;
  window.answerFreeQuestion = answerFreeQuestion;
}
