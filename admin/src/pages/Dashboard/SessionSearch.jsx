import { useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import { Box, SearchForm, Searchbar } from '@strapi/design-system';
import styled from 'styled-components';
import { getTranslation } from '../../utils/getTranslation';

/**
 * The DS Searchbar clear button is 22 px; this gives it the 24 px minimum
 * target size (WCAG 2.5.8) without changing the field height.
 */
const SearchWrapper = styled(Box)`
  & button {
    min-width: 2.4rem;
    min-height: 2.4rem;
    justify-content: center;
  }
`;

/** Delay before typing updates the URL and the list. */
const SEARCH_DEBOUNCE_MS = 300;

/**
 * Always-visible search field (IA D1.5). Strapi's SearchInput collapses to an
 * icon-only button while empty, which hid the placeholder; this uses the same
 * Design System Searchbar but keeps it open. The value lives in the URL
 * (`?search=`), so "Show all sessions" links from the user panel prefill it.
 * Typing filters after a short pause; Enter applies at once; Clear empties it.
 *
 * @param {object} props
 * @param {string} props.value Current search from the URL.
 * @param {(value: string) => void} props.onSearch Writes the search to the URL.
 * @returns {import('react').ReactElement} Search form.
 */
const SessionSearch = ({ value, onSearch }) => {
  const { formatMessage } = useIntl();
  const t = (id, defaultMessage) => formatMessage({ id: getTranslation(id), defaultMessage });
  const [draft, setDraft] = useState(value);
  const lastApplied = useRef(value);

  // Follow URL changes made elsewhere (Clear filters, back button, links).
  useEffect(() => {
    if (value !== lastApplied.current) {
      lastApplied.current = value;
      setDraft(value);
    }
  }, [value]);

  useEffect(() => {
    const next = draft.trim();
    if (next === lastApplied.current) return undefined;
    const timer = setTimeout(() => {
      lastApplied.current = next;
      onSearch(next);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, onSearch]);

  const apply = (next) => {
    lastApplied.current = next;
    onSearch(next);
  };

  return (
    <SearchWrapper width="100%" data-session-search="">
      <SearchForm
        onSubmit={(event) => {
          event.preventDefault();
          apply(draft.trim());
        }}
      >
        <Searchbar
          name="search"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onClear={() => {
            setDraft('');
            apply('');
          }}
          clearLabel={t('homepage.search.clear', 'Clear search')}
          placeholder={t('homepage.search.placeholder', 'Search user, email, IP or device')}
        >
          {t('homepage.search.label', 'Search sessions')}
        </Searchbar>
      </SearchForm>
    </SearchWrapper>
  );
};

export default SessionSearch;
