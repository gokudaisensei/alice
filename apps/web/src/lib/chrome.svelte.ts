/** Shared bits of the shell that pages need to talk to: the collapsing title and the search sheet. */
class Chrome {
	title = $state('');
	/** true once the page's large title has scrolled out of view */
	compact = $state(false);
	search = $state(false);
}
export const chrome = new Chrome();
