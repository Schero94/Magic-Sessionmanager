import { useId } from 'react';
import { Flex } from '@strapi/design-system';
import styled from 'styled-components';
import { Layouts, Page } from '@strapi/strapi/admin';
import { paragraphRhythm } from '../ReadableText';

/**
 * Content column inside Layouts.Content. It adds NO horizontal padding:
 * Layouts.Content already applies Strapi's responsive page gutters, so the
 * first card shares its left/right edge with the page title (DUX-10, DASH-03,
 * SET-10, F14). Only the vertical rhythm between sections is set here.
 */
const PageContent = styled(Flex)`
  width: 100%;
  min-width: 0;

  ${paragraphRhythm}
`;

/**
 * Native Strapi page frame used by every plugin screen:
 * Page.Main + Layouts.Header + optional Layouts.Action + Layouts.Content.
 * A string title also becomes the document title through Page.Title, so the
 * browser tab does not keep the previous page's title after navigation.
 *
 * @param {object} props
 * @param {string} [props.headingId] Id of the h1; generated when omitted.
 * @param {import('react').ReactNode} props.title Page title (h1).
 * @param {string} [props.documentTitle] Document title; defaults to a string `title`.
 * @param {import('react').ReactNode} [props.subtitle] Page subtitle.
 * @param {import('react').ReactNode} [props.primaryAction] Primary header action.
 * @param {import('react').ReactNode} [props.secondaryAction] Secondary header action.
 * @param {import('react').ReactNode} [props.navigationAction] Back link above the title.
 * @param {import('react').ReactNode} [props.startActions] Layouts.Action start slot (search, filters).
 * @param {import('react').ReactNode} [props.endActions] Layouts.Action end slot.
 * @param {import('react').ReactNode} props.children Page sections.
 * @returns {import('react').ReactElement} A Strapi admin page.
 */
const PageShell = ({
  headingId,
  title,
  documentTitle,
  subtitle,
  primaryAction,
  secondaryAction,
  navigationAction,
  startActions,
  endActions,
  children,
}) => {
  const generatedId = useId();
  const titleId = headingId || `page-title-${generatedId.replace(/:/g, '')}`;
  const hasActionBar = Boolean(startActions || endActions);
  const tabTitle = documentTitle || (typeof title === 'string' ? title : '');

  return (
    <Page.Main aria-labelledby={titleId}>
      {tabTitle ? <Page.Title>{tabTitle}</Page.Title> : null}
      <Layouts.Header
        id={titleId}
        title={title}
        subtitle={subtitle}
        primaryAction={primaryAction}
        secondaryAction={secondaryAction}
        navigationAction={navigationAction}
      />
      {hasActionBar ? <Layouts.Action startActions={startActions} endActions={endActions} /> : null}
      <Layouts.Content>
        <PageContent
          direction="column"
          alignItems="stretch"
          gap={6}
          paddingBottom={8}
          data-text-rhythm="page"
          data-page-shell=""
        >
          {children}
        </PageContent>
      </Layouts.Content>
    </Page.Main>
  );
};

export default PageShell;
