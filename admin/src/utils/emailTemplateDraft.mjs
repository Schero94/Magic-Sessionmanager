/** Return an updated template collection without changing the saved baseline. */
export function updateEmailTemplate(templates, templateKey, field, value) {
  return { ...templates, [templateKey]: { ...templates[templateKey], [field]: value } };
}
