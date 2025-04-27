import { App, Editor, MarkdownView, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';

interface SEOAssistantSettings {
	apiBaseUrl: string;
	apiKey: string;
	modelName: string;
}

const DEFAULT_SETTINGS: SEOAssistantSettings = {
	apiBaseUrl: 'https://api.openai.com/v1',
	apiKey: '',
	modelName: 'gpt-3.5-turbo'
}

export default class SEOAssistantPlugin extends Plugin {
	settings: SEOAssistantSettings;

	async onload() {
		await this.loadSettings();

		// Add command to generate SEO description and keywords
		this.addCommand({
			id: 'generate-seo-description-keywords',
			name: 'Generate SEO Description and Keywords',
			hotkeys: [{ modifiers: ['Ctrl', 'Alt'], key: 'S' }],
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.generateSEO(editor, view);
			}
		});

		// Add settings tab
		this.addSettingTab(new SEOAssistantSettingTab(this.app, this));
	}

	onunload() {
		// Cleanup when plugin is disabled
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async generateSEO(editor: Editor, view: MarkdownView) {
		// Get current document content
		const documentContent = editor.getValue();

		if (!documentContent) {
			new Notice('Document is empty, cannot generate SEO description and keywords');
			return;
		}

		// Show loading notice
		const loadingNotice = new Notice('Generating SEO description and keywords...', 0);

		try {
			// Call API to generate SEO description and keywords
			const seoContent = await this.callLLMApi(documentContent);

			// Hide loading notice
			loadingNotice.hide();

			if (seoContent) {
				// Directly update document frontmatter
				this.updateFrontmatter(editor, seoContent);
			} else {
				new Notice('Failed to generate SEO content, please check API settings and network connection');
			}
		} catch (error) {
			// Hide loading notice
			loadingNotice.hide();

			// Show error message
			console.error('Error generating SEO content:', error);
			new Notice(`Error generating SEO content: ${error.message || 'Unknown error'}`);
		}
	}

	/**
	 * Update document frontmatter
	 */
	updateFrontmatter(editor: Editor, seoContent: { description: string, keywords: string }) {
		const content = editor.getValue();
		let newContent = '';

		// Check if document already has frontmatter
		const frontmatterRegex = /^---\n([\s\S]*?)\n---\n/;
		const frontmatterMatch = content.match(frontmatterRegex);

		if (frontmatterMatch) {
			// Document has frontmatter, update or add description and keywords
			const frontmatter = frontmatterMatch[1];
			let updatedFrontmatter = frontmatter;

			// Update description
			const descriptionRegex = /^description:\s*(.*)$/m;
			if (descriptionRegex.test(updatedFrontmatter)) {
				updatedFrontmatter = updatedFrontmatter.replace(descriptionRegex, `description: "${seoContent.description}"`);
			} else {
				updatedFrontmatter += `\ndescription: "${seoContent.description}"`;
			}

			// Update keywords
			const keywordsRegex = /^keywords:\s*(.*)$/m;
			if (keywordsRegex.test(updatedFrontmatter)) {
				updatedFrontmatter = updatedFrontmatter.replace(keywordsRegex, `keywords: ${seoContent.keywords}`);
			} else {
				updatedFrontmatter += `\nkeywords: ${seoContent.keywords}`;
			}

			// Replace original frontmatter
			newContent = content.replace(frontmatterRegex, `---\n${updatedFrontmatter}\n---\n`);
		} else {
			// No frontmatter, add new one
			newContent = `---\ndescription: "${seoContent.description}"\nkeywords: ${seoContent.keywords}\n---\n\n${content}`;
		}

		// Update editor content
		editor.setValue(newContent);

		// Show success notice
		new Notice('Document frontmatter has been updated');
	}

	async callLLMApi(documentContent: string): Promise<{ description: string, keywords: string } | null> {
		// Check API settings
		if (!this.settings.apiKey) {
			new Notice('Please configure API key in settings');
			return null;
		}

		try {
			// Build API request
			const response = await fetch(`${this.settings.apiBaseUrl}/chat/completions`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${this.settings.apiKey}`
				},
				body: JSON.stringify({
					model: this.settings.modelName,
					messages: [
						{
							role: 'system',
							content: 'You are an SEO expert, skilled at generating concise, attractive, and SEO-optimized descriptions and keywords for articles.'
						},
						{
							role: 'user',
							content: `Please generate an SEO-friendly description (no more than 150 characters) and 5-8 keywords (comma-separated) for the following Markdown document. Please return in JSON format with description and keywords fields.\n\n${documentContent}`
						}
					],
					temperature: 0.7,
					max_tokens: 500
				})
			});

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(`API request failed: ${response.status} ${errorData.error?.message || response.statusText}`);
			}

			const data = await response.json();
			const content = data.choices[0]?.message?.content;

			if (!content) {
				throw new Error('API returned empty content');
			}

			// Parse JSON response
			try {
				// Try to parse JSON directly
				const jsonMatch = content.match(/\{[\s\S]*\}/);
				const jsonStr = jsonMatch ? jsonMatch[0] : content;
				const result = JSON.parse(jsonStr);

				return {
					description: result.description || '',
					keywords: result.keywords || ''
				};
			} catch (parseError) {
				console.error('Error parsing API response:', parseError);

				// Try to extract description and keywords using regex
				const descriptionMatch = content.match(/description["\s:]+([^"]+)/i);
				const keywordsMatch = content.match(/keywords["\s:]+([^"]+)/i);

				return {
					description: descriptionMatch ? descriptionMatch[1].trim() : '',
					keywords: keywordsMatch ? keywordsMatch[1].trim() : ''
				};
			}
		} catch (error) {
			console.error('Error calling API:', error);
			throw error;
		}
	}
}

class SEOAssistantSettingTab extends PluginSettingTab {
	plugin: SEOAssistantPlugin;

	constructor(app: App, plugin: SEOAssistantPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'SEO Assistant Settings' });

		new Setting(containerEl)
			.setName('API Base URL')
			.setDesc('Set the base URL for OpenAI-compatible API')
			.addText(text => text
				.setPlaceholder('https://api.openai.com/v1')
				.setValue(this.plugin.settings.apiBaseUrl)
				.onChange(async (value) => {
					this.plugin.settings.apiBaseUrl = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('API Key')
			.setDesc('Set the API key required for access')
			.addText(text => text
				.setPlaceholder('sk-...')
				.setValue(this.plugin.settings.apiKey)
				.onChange(async (value) => {
					this.plugin.settings.apiKey = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Model Name')
			.setDesc('Set the model name to use (choose an OpenAI-compatible model)')
			.addText(text => text
				.setPlaceholder('gpt-3.5-turbo')
				.setValue(this.plugin.settings.modelName)
				.onChange(async (value) => {
					this.plugin.settings.modelName = value;
					await this.plugin.saveSettings();
				}));

		// Add info message
		const infoDiv = containerEl.createDiv();
		infoDiv.addClass('setting-item-info');
		infoDiv.innerHTML = 'Note: Please ensure you use an OpenAI-compatible model such as gpt-3.5-turbo, gpt-4, etc. Generated SEO descriptions and keywords will be automatically written to the document frontmatter.';
	}
}
