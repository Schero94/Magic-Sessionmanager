import { Typography } from '@strapi/design-system';
import styled, { css } from 'styled-components';

/**
 * Shared paragraph and list rhythm for explanatory copy in plugin surfaces.
 * It intentionally does not target labels, table cells, or metric values.
 */
export const paragraphRhythm = css`
  p {
    max-width: 72ch;
    margin-block: 0;
    line-height: 1.6;
    text-wrap: pretty;
  }

  p + p {
    margin-block-start: 12px;
  }

  li {
    max-width: 72ch;
    line-height: 1.6;
    text-wrap: pretty;
  }

  li + li {
    margin-block-start: 6px;
  }
`;

/**
 * Renders readable body copy with a comfortable line length and consistent
 * separation when consecutive paragraphs are used.
 *
 * @returns {import('react').ReactElement} A Strapi typography paragraph.
 */
const ReadableText = styled(Typography)`
  display: block;
  width: 100%;
  min-width: 0;
  max-width: 72ch;
  margin: 0;
  line-height: 1.6;
  text-wrap: pretty;

  & + & {
    margin-block-start: 12px;
  }
`;

const ParagraphGroup = styled.div`
  display: block;
  width: 100%;
  min-width: 0;
`;

const InlineParagraphGroup = styled.span`
  display: block;
  width: 100%;
  min-width: 0;
`;

/**
 * Renders translated text as separate, consistently spaced paragraphs when
 * the copy contains a blank line. Single-paragraph hints keep their compact
 * layout without needing a second presentation component.
 *
 * @param {{ id?: string, text: string, variant?: string, textColor?: string, tag?: string }} props Paragraph text and Strapi typography options.
 * @returns {import('react').ReactElement} A shrink-safe group of readable paragraphs.
 */
export const ReadableParagraphs = ({ id, text, ...typographyProps }) => {
  const ParagraphContainer = typographyProps.tag === 'span' ? InlineParagraphGroup : ParagraphGroup;
  const paragraphs = String(text ?? '')
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return (
    <ParagraphContainer id={id} data-readable-paragraphs="">
      {paragraphs.map((paragraph, index) => (
        <ReadableText
          key={`${id || 'readable-paragraph'}-${index}`}
          {...typographyProps}
          tag={typographyProps.tag || 'p'}
        >
          {paragraph}
        </ReadableText>
      ))}
    </ParagraphContainer>
  );
};

export default ReadableText;
