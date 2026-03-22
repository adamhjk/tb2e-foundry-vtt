"""Token generation: OpenAI API call + image pipeline orchestration."""

from openai import OpenAI

from .prompts import assemble_prompt
from .pipeline import download_image, process_image


def generate_token(description, *, style="portrait", stock=None, character_class=None,
                   output_path, size=400, quality=90, remove_bg=True,
                   keep_intermediate=False, api_key=None, verbose=False):
    """Generate a token image from a text description."""
    prompt = assemble_prompt(
        description, style=style, stock=stock, character_class=character_class
    )

    if verbose:
        print(f"Assembled prompt:\n  {prompt}\n")

    client = OpenAI(api_key=api_key)

    print("Generating image with DALL-E 3...")
    response = client.images.generate(
        model="dall-e-3",
        prompt=prompt,
        size="1024x1024",
        quality="standard",
        n=1,
    )

    image_url = response.data[0].url
    revised_prompt = response.data[0].revised_prompt

    if verbose and revised_prompt:
        print(f"Revised prompt:\n  {revised_prompt}\n")

    print("Downloading image...")
    image = download_image(image_url)

    print("Processing image...")
    process_image(
        image,
        size=size,
        quality=quality,
        output_path=output_path,
        remove_bg=remove_bg,
        keep_intermediate=keep_intermediate,
    )

    print(f"Token saved: {output_path} ({size}x{size})")
