import { useState } from 'react';
import manual from '../content/adminManual.json';

type Lang = 'en' | 'nl';

type Localized = Record<Lang, string>;

type Block =
  | { type: 'h3'; en: string; nl: string }
  | { type: 'p'; en: string; nl: string }
  | { type: 'note'; en: string; nl: string }
  | { type: 'ul' | 'ol'; en: string[]; nl: string[] };

interface Section {
  id: string;
  title: Localized;
  blocks: Block[];
}

const data = manual as { title: Localized; intro: Localized; sections: Section[] };

const LANG_LABEL: Record<Lang, string> = { en: 'English', nl: 'Nederlands' };

export function ManualPage() {
  const [lang, setLang] = useState<Lang>('en');

  return (
    <div>
      <div className="section-heading">
        <h1>{data.title[lang]}</h1>
        <div className="section-heading-actions">
          {(['en', 'nl'] as const).map((l) => (
            <button
              key={l}
              type="button"
              className={`tab-button${lang === l ? ' tab-button-active' : ''}`}
              onClick={() => setLang(l)}
            >
              {LANG_LABEL[l]}
            </button>
          ))}
        </div>
      </div>
      <p>{data.intro[lang]}</p>

      {data.sections.map((section) => (
        <section key={section.id}>
          <h2>{section.title[lang]}</h2>
          {section.blocks.map((block, i) => (
            <ManualBlock key={i} block={block} lang={lang} />
          ))}
        </section>
      ))}
    </div>
  );
}

function ManualBlock({ block, lang }: { block: Block; lang: Lang }) {
  switch (block.type) {
    case 'h3':
      return <h3>{block[lang]}</h3>;
    case 'p':
      return <p>{block[lang]}</p>;
    case 'note':
      return <p className="hint-text">{block[lang]}</p>;
    case 'ul':
      return (
        <ul>
          {block[lang].map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      );
    case 'ol':
      return (
        <ol>
          {block[lang].map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ol>
      );
  }
}
