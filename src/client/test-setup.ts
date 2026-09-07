// @testing-library/jest-dom requires expect to be global, which happens after setup files in vitest projects.
// We'll skip jest-dom matchers for now and use basic vitest assertions.