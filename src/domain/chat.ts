import type { Evidence, MultilingualIssueContext, ReviewCase, ReviewIssue } from "./types";

export type ReviewChatResponse = {
  id: string;
  question: string;
  answerType: "evidence_based" | "insufficient_evidence";
  content: string;
  evidence: Evidence[];
  requiredMaterials: string[];
};

export type ChatProgressStage =
  | "analyzing_intent"
  | "searching_knowledge"
  | "knowledge_hit"
  | "knowledge_miss"
  | "mcp_failed"
  | "generating_answer";

export type ChatProgressEvent =
  | { type: "stage"; stage: ChatProgressStage; label: string }
  | { type: "mcp"; stage: "mcp_search_law" | "mcp_get_law_text"; tool: string; query: string; label: string }
  | { type: "done"; response: ReviewChatResponse }
  | { type: "error"; message: string };

export function chatProgressLabel(event: ChatProgressEvent | null): string {
  if (!event || event.type === "done" || event.type === "error") {
    return "답변 생성 중";
  }

  return event.label;
}

/**
 * Language the review opinion draft should be written in.
 *
 * "ko" is the default for purely Korean material. The other codes mirror the
 * multilingual analysis pipeline's supported source languages so that, when a
 * non-Korean ad segment is detected, the draft is written in that language.
 */
export type DraftLanguage = "ko" | MultilingualIssueContext["language"];

type DraftLabels = {
  heading: string;
  subject: string;
  productType: string;
  publishDate: string;
  keyIssues: string;
  riskLevel: string;
  targetText: string;
  rationale: string;
  suggestion: string;
  references: string;
  summaryHeading: string;
  summaryBody: string;
  risk: Record<ReviewIssue["riskLevel"], string>;
  chatReflection: (evidenceTitles: string) => string;
};

const draftLabelsByLanguage: Record<DraftLanguage, DraftLabels> = {
  ko: {
    heading: "수정 요청 의견 초안",
    subject: "심의 대상",
    productType: "상품군",
    publishDate: "게시 예정일",
    keyIssues: "주요 검토 이슈",
    riskLevel: "위험 수준",
    targetText: "대상 문구",
    rationale: "판단 근거",
    suggestion: "수정 의견",
    references: "참고 출처",
    summaryHeading: "종합 의견:",
    summaryBody: "위 이슈가 반영된 수정본 제출 후 재검토가 필요합니다.",
    risk: { info: "참고", caution: "주의", high: "위험" },
    chatReflection: (titles) =>
      `채팅 반영: 선택 이슈 질의에서 확인한 근거(${titles})를 기준으로 우대 조건을 본문 또는 인접 고지에 명확히 표시하도록 요청합니다.`
  },
  en: {
    heading: "Revision Request Opinion Draft",
    subject: "Review subject",
    productType: "Product type",
    publishDate: "Planned publish date",
    keyIssues: "Key review issues",
    riskLevel: "Risk level",
    targetText: "Target text",
    rationale: "Assessment basis",
    suggestion: "Suggested revision",
    references: "References",
    summaryHeading: "Overall opinion:",
    summaryBody: "Please submit a revised version reflecting the issues above for re-review.",
    risk: { info: "Info", caution: "Caution", high: "High" },
    chatReflection: (titles) =>
      `Chat context: Based on the evidence confirmed in the selected issue Q&A (${titles}), please clearly present the conditional benefit in the body text or an adjacent disclosure.`
  },
  vi: {
    heading: "Bản nháp ý kiến yêu cầu chỉnh sửa",
    subject: "Đối tượng thẩm định",
    productType: "Loại sản phẩm",
    publishDate: "Ngày dự kiến đăng",
    keyIssues: "Các vấn đề thẩm định chính",
    riskLevel: "Mức độ rủi ro",
    targetText: "Nội dung liên quan",
    rationale: "Cơ sở đánh giá",
    suggestion: "Ý kiến chỉnh sửa",
    references: "Nguồn tham khảo",
    summaryHeading: "Ý kiến tổng hợp:",
    summaryBody: "Vui lòng nộp bản chỉnh sửa phản ánh các vấn đề nêu trên để thẩm định lại.",
    risk: { info: "Tham khảo", caution: "Lưu ý", high: "Rủi ro cao" },
    chatReflection: (titles) =>
      `Bối cảnh trò chuyện: Dựa trên căn cứ đã xác nhận trong phần hỏi đáp về vấn đề đã chọn (${titles}), vui lòng nêu rõ điều kiện ưu đãi trong nội dung chính hoặc phần công bố liền kề.`
  },
  my: {
    heading: "ပြင်ဆင်ရန် တောင်းဆိုချက် သဘောထားမူကြမ်း",
    subject: "စိစစ်သည့် အကြောင်းအရာ",
    productType: "ထုတ်ကုန်အမျိုးအစား",
    publishDate: "ထုတ်ဝေရန် စီစဉ်ထားသည့်ရက်",
    keyIssues: "အဓိက စိစစ်ရန် ကိစ္စရပ်များ",
    riskLevel: "အန္တရာယ်အဆင့်",
    targetText: "သက်ဆိုင်သည့် စာသား",
    rationale: "ဆုံးဖြတ်ချက် အခြေခံ",
    suggestion: "ပြင်ဆင်ရန် အကြံပြုချက်",
    references: "ကိုးကားချက်များ",
    summaryHeading: "ခြုံငုံသဘောထား:",
    summaryBody:
      "အထက်ပါ ကိစ္စရပ်များကို ထည့်သွင်းပြင်ဆင်ထားသော မူကြမ်းကို ပြန်လည်စိစစ်ရန် တင်ပြပေးပါ။",
    risk: { info: "သတင်းအချက်", caution: "သတိ", high: "မြင့်" },
    chatReflection: (titles) =>
      `စကားပြောအကြောင်းအရာ: ရွေးချယ်ထားသော ကိစ္စရပ် မေးခွန်းများတွင် အတည်ပြုထားသော အထောက်အထား (${titles}) ကို အခြေခံ၍ အကျိုးခံစားခွင့် အခြေအနေကို ပင်မစာသား သို့မဟုတ် ကပ်လျက်ထုတ်ဖော်ချက်တွင် ရှင်းလင်းစွာ ဖော်ပြပေးပါ။`
  },
  km: {
    heading: "សេចក្តីព្រាងមតិស្នើសុំកែប្រែ",
    subject: "កម្មវត្ថុនៃការត្រួតពិនិត្យ",
    productType: "ប្រភេទផលិតផល",
    publishDate: "កាលបរិច្ឆេទគ្រោងផ្សាយ",
    keyIssues: "បញ្ហាត្រួតពិនិត្យសំខាន់ៗ",
    riskLevel: "កម្រិតហានិភ័យ",
    targetText: "អត្ថបទពាក់ព័ន្ធ",
    rationale: "មូលដ្ឋានវាយតម្លៃ",
    suggestion: "មតិកែប្រែ",
    references: "ឯកសារយោង",
    summaryHeading: "មតិរួម៖",
    summaryBody: "សូមដាក់ស្នើកំណែដែលបានកែប្រែតាមបញ្ហាខាងលើ ដើម្បីធ្វើការត្រួតពិនិត្យឡើងវិញ។",
    risk: { info: "ព័ត៌មាន", caution: "ប្រុងប្រយ័ត្ន", high: "ខ្ពស់" },
    chatReflection: (titles) =>
      `បរិបទជជែក៖ ផ្អែកលើភស្តុតាងដែលបានបញ្ជាក់ក្នុងសំណួរ-ចម្លើយនៃបញ្ហាដែលបានជ្រើសរើស (${titles}) សូមបង្ហាញលក្ខខណ្ឌអត្ថប្រយោជន៍ឱ្យបានច្បាស់នៅក្នុងអត្ថបទមេ ឬការបង្ហាញព័ត៌មាននៅជាប់គ្នា។`
  }
};

const riskRank: Record<ReviewIssue["riskLevel"], number> = {
  info: 1,
  caution: 2,
  high: 3
};

/**
 * Detects the dominant non-Korean language across analyzed issues.
 *
 * Each issue may carry a multilingualContext produced by the translator-risk
 * agents. When one or more issues reference a non-Korean source language, the
 * most frequent language wins (ties resolve to the earliest-detected language).
 * Returns "ko" when no multilingual context is present.
 */
export function detectReviewDraftLanguage(review: ReviewCase): DraftLanguage {
  const counts = new Map<DraftLanguage, number>();

  for (const issue of review.issues) {
    const language = issue.multilingualContext?.language;

    if (language) {
      counts.set(language, (counts.get(language) ?? 0) + 1);
    }
  }

  let detected: DraftLanguage = "ko";
  let highestCount = 0;

  for (const [language, count] of counts) {
    if (count > highestCount) {
      detected = language;
      highestCount = count;
    }
  }

  return detected;
}

function localizedTargetText(issue: ReviewIssue, language: DraftLanguage): string {
  if (language !== "ko" && issue.multilingualContext?.originalText) {
    return issue.multilingualContext.originalText;
  }

  return issue.targetText;
}

function localizedSuggestion(issue: ReviewIssue, language: DraftLanguage): string {
  if (language !== "ko" && issue.multilingualContext?.suggestedCopyOriginalLanguage) {
    return issue.multilingualContext.suggestedCopyOriginalLanguage;
  }

  return issue.suggestedCopy;
}

function compactLines(lines: Array<string | undefined>): string[] {
  return lines.map((line) => line?.trim() ?? "").filter((line) => line.length > 0);
}

function evidenceSourceLabel(evidence: Evidence): string {
  return compactLines([evidence.title, evidence.section]).join(" ");
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

export function answerReviewQuestion({
  review,
  issue,
  question
}: {
  review: ReviewCase;
  issue: ReviewIssue;
  question: string;
}): ReviewChatResponse {
  const normalizedQuestion = question.replace(/\s+/g, " ").trim();
  const asksForTerms = normalizedQuestion.includes("약관");
  const termsMissing = !review.files.some((file) => file.fileType === "terms");

  if (asksForTerms && termsMissing) {
    return {
      id: `msg-${issue.id}-fallback`,
      question,
      answerType: "insufficient_evidence",
      content:
        "추가 확인 필요: 현재 업로드된 자료와 승인된 지식베이스에서는 약관에만 있는 조건을 단정할 근거가 부족합니다.",
      evidence: [],
      requiredMaterials: ["약관"]
    };
  }

  return {
    id: `msg-${issue.id}-evidence`,
    question,
    answerType: "evidence_based",
    content:
      "현재 근거상 조건부 혜택임을 본문 또는 인접 고지에서 명확히 표시하는 수정이 필요합니다.",
    evidence: issue.evidence,
    requiredMaterials: []
  };
}

export function generateDraftWithChatContext(
  review: ReviewCase,
  chatResponses: ReviewChatResponse[]
): string {
  const baseDraft = generateIssueBasedOpinionDraft(review);
  const evidenceTitles = Array.from(
    new Set(
      chatResponses.flatMap((response) => response.evidence.map((evidence) => evidence.title))
    )
  );

  if (chatResponses.length === 0 || evidenceTitles.length === 0) {
    return baseDraft;
  }

  const labels = draftLabelsByLanguage[detectReviewDraftLanguage(review)];

  return `${baseDraft}\n\n${labels.chatReflection(evidenceTitles.join(", "))}`;
}

export function generateIssueBasedOpinionDraft(review: ReviewCase): string {
  if (review.issues.length === 0) {
    return review.expectedDraft;
  }

  const language = detectReviewDraftLanguage(review);
  const labels = draftLabelsByLanguage[language];
  const issues = [...review.issues].sort(
    (left, right) => riskRank[right.riskLevel] - riskRank[left.riskLevel]
  );
  const lines = [
    labels.heading,
    "",
    `${labels.subject}: ${review.affiliate} ${review.title}`,
    `${labels.productType}: ${review.productType}`,
    `${labels.publishDate}: ${review.plannedPublishDate}`,
    "",
    labels.keyIssues
  ];

  issues.forEach((issue, index) => {
    const evidenceSources = unique(issue.evidence.map(evidenceSourceLabel));
    lines.push(
      "",
      `${index + 1}. ${issue.title}`,
      `- ${labels.riskLevel}: ${labels.risk[issue.riskLevel]}`,
      `- ${labels.targetText}: ${localizedTargetText(issue, language)}`,
      `- ${labels.rationale}: ${issue.description}`,
      `- ${labels.suggestion}: ${localizedSuggestion(issue, language)}`
    );

    if (evidenceSources.length > 0) {
      lines.push(`- ${labels.references}: ${evidenceSources.join(", ")}`);
    }
  });

  lines.push("", labels.summaryHeading, labels.summaryBody);

  return lines.join("\n");
}

export function shouldReplaceStaleOpinionDraft(draft?: string): boolean {
  const text = draft?.trim();

  if (!text) {
    return true;
  }

  return /OCR\/RAG 분석 전|실제 업로드 자료 분석 대기|근거 부족 상태|파일 분류와 누락 자료|구체적 근거 확인이 어렵|자료만으로는 광고 표시 내용/.test(
    text
  );
}
